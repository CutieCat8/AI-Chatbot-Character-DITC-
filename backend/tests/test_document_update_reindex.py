"""Regression tests for document status updates and chunk replacement."""

from datetime import datetime, timezone
from unittest.mock import MagicMock, call

from app.models.enums import Language, SourceSite
from app.models.knowledge import Document, DocumentChunk
from app.rag.indexer import index_one_document
from app.routers import documents as documents_router
from app.schemas.document import DocumentUpdateIn


class FakeEmbedder:
    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 1024 for _ in texts]


def make_document() -> Document:
    now = datetime.now(timezone.utc)
    doc = Document(
        id=141,
        source_site=SourceSite.MANUAL,
        source_url="manual://141",
        title="Test Attention",
        content="This content is long enough to produce a searchable document chunk for testing.",
        content_hash="hash",
        language=Language.TH,
        is_active=False,
        scraped_at=None,
        created_at=now,
        updated_at=now,
    )
    return doc


def test_status_only_update_does_not_reindex(monkeypatch):
    doc = make_document()
    db = MagicMock()
    db.get.return_value = doc
    db.scalar.return_value = 1

    def unexpected_reindex(*_args, **_kwargs):
        raise AssertionError("status-only update must not re-index unchanged content")

    monkeypatch.setattr(documents_router, "index_one_document", unexpected_reindex)

    result = documents_router.update_document(
        141,
        DocumentUpdateIn(content=doc.content, is_active=True),
        db,
    )

    assert result.is_active is True
    assert result.chunk_count == 1
    db.commit.assert_called_once()


def test_chunk_delete_is_flushed_before_replacement_insert():
    doc = make_document()
    doc.chunks.append(
        DocumentChunk(
            document_id=141,
            chunk_index=0,
            content="old chunk",
            token_count=2,
            embedding=[0.0] * 1024,
        )
    )
    db = MagicMock()

    count = index_one_document(db, doc, FakeEmbedder())

    assert count == 1
    assert db.method_calls[0] == call.flush()
    assert db.add.call_count == 1
