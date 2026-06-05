"""SQLAlchemy models for the DOI tables (Reporter V2.5 FastAPI backend).

These mirror integration/schema.sql and the Prisma models one-for-one (same
snake_case table/column names), so whichever side owns a given write, both read the
identical schema. Every table is operator-scoped to preserve multi-tenant isolation.

If Reporter already defines a declarative Base, import that instead of the local one
below so these tables share your metadata and migrations (Alembic).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TitleProject(Base):
    __tablename__ = "title_projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operator_id: Mapped[str] = mapped_column(String, nullable=False)  # tenant key
    name: Mapped[str] = mapped_column(String, nullable=False)
    tract: Mapped[dict] = mapped_column(JSONB, nullable=False)         # {name, grossAcres, legal, county, state}
    unit_id: Mapped[str | None] = mapped_column(String)               # optional link to a Reporter unit/well
    project: Mapped[dict] = mapped_column(JSONB, nullable=False)       # full TitleProject (engine input)
    balances: Mapped[bool | None] = mapped_column(Boolean)            # last computed deck == 1.00000000
    created_by: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    source_files: Mapped[list["TitleSourceFile"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    decks: Mapped[list["DoiDeck"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    curative: Mapped[list["DoiCurative"]] = relationship(back_populates="project", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_title_projects_operator", "operator_id"),
        Index("idx_title_projects_unit", "operator_id", "unit_id"),
    )


class TitleSourceFile(Base):
    __tablename__ = "title_source_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operator_id: Mapped[str] = mapped_column(String, nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("title_projects.id", ondelete="CASCADE")
    )
    filename: Mapped[str] = mapped_column(String, nullable=False)
    gcs_object: Mapped[str] = mapped_column(String, nullable=False)   # private object path; serve via signed URL
    media_type: Mapped[str | None] = mapped_column(String)
    extraction: Mapped[dict | None] = mapped_column(JSONB)            # ExtractionResult (fields/snippets/confidence)
    engine: Mapped[str | None] = mapped_column(String)               # 'gemini' | 'claude' | 'heuristic'
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped["TitleProject | None"] = relationship(back_populates="source_files")

    __table_args__ = (Index("idx_title_files_project", "project_id"),)


class DoiDeck(Base):
    __tablename__ = "doi_decks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operator_id: Mapped[str] = mapped_column(String, nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("title_projects.id", ondelete="CASCADE"), nullable=False
    )
    basis: Mapped[str] = mapped_column(String, nullable=False, default="tract")  # 'tract' | 'unit'
    unit_factor: Mapped[float | None] = mapped_column(Numeric(18, 12))
    rows: Mapped[list] = mapped_column(JSONB, nullable=False)         # [{owner,type,fractionLabel,nri,unitNri,source}]
    total_nri: Mapped[float] = mapped_column(Numeric(18, 12), nullable=False)  # tract basis: 1.000000000000
    balances: Mapped[bool] = mapped_column(Boolean, nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String)          # set on landman sign-off
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ledger_hash: Mapped[str | None] = mapped_column(String)          # SHA-256 → append-only audit ledger
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped["TitleProject"] = relationship(back_populates="decks")

    __table_args__ = (Index("idx_doi_decks_project", "project_id"),)


class DoiCurative(Base):
    __tablename__ = "doi_curative"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operator_id: Mapped[str] = mapped_column(String, nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("title_projects.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String, nullable=False)        # NPRI_INTERPRETATION, WI_NRI_MISMATCH, …
    severity: Mapped[str] = mapped_column(String, nullable=False)    # critical | high | medium | info
    title: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="open")  # open | resolved | waived
    resolved_by: Mapped[str | None] = mapped_column(String)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped["TitleProject"] = relationship(back_populates="curative")

    __table_args__ = (Index("idx_doi_curative_project", "project_id", "status"),)
