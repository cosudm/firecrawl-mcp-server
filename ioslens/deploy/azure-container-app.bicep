// =============================================================================
// iOSLENS control plane on Azure Container Apps (§02 inventory).
//
// Deploys into Lamar's Azure subscription (resource group rg-ioslens-pilot,
// SMEPro-operated): a Container Apps environment, the iOSLENS MCP container app
// (2–4 vCPU / 4–8 GB, consumption), and Key Vault secret references for the
// Ethos keys, DB credentials, and app secrets — no secrets in code (§02).
//
//   az deployment group create -g rg-ioslens-pilot \
//     -f deploy/azure-container-app.bicep \
//     -p image=<acr>/ioslens:1.0.0 keyVaultName=kv-ioslens-pilot \
//        entraTenantId=<tid> entraAudience=api://ioslens-mcp
// =============================================================================

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Container image, e.g. <registry>.azurecr.io/ioslens:1.0.0')
param image string

@description('Name of the existing Key Vault holding DATABASE_URL and Ethos secrets.')
param keyVaultName string

@description('Entra tenant id for Layer-1 JWT validation.')
param entraTenantId string

@description('Entra audience (Application ID URI) the MCP server accepts.')
param entraAudience string

@description('CPU cores (pilot: 2). Firm sizing follows a capacity estimate (§02).')
param cpu int = 2

@description('Memory, e.g. 4Gi (pilot).')
param memory string = '4Gi'

var appName = 'ioslens-mcp'
var lawName = 'log-ioslens-pilot'
var envName = 'cae-ioslens-pilot'

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource managedEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        // Internal ingress: the MCP server stays within Lamar's tenant boundary
        // (§06.4). Front with Entra App Proxy / private endpoint if Copilot must
        // reach it from the Microsoft cloud.
        external: false
        targetPort: 8080
        transport: 'http'
      }
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/database-url'
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: image
          resources: {
            cpu: json('${cpu}')
            memory: memory
          }
          env: [
            { name: 'MCP_TRANSPORT', value: 'http' }
            { name: 'MCP_HTTP_PORT', value: '8080' }
            { name: 'MCP_AUTH', value: 'entra' }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'ENTRA_AUDIENCE', value: entraAudience }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
          ]
          probes: [
            { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 }, initialDelaySeconds: 10, periodSeconds: 30 }
            { type: 'Readiness', httpGet: { path: '/healthz', port: 8080 }, initialDelaySeconds: 5, periodSeconds: 15 }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 4
      }
    }
  }
}

output mcpFqdn string = app.properties.configuration.ingress.fqdn
output principalId string = app.identity.principalId
