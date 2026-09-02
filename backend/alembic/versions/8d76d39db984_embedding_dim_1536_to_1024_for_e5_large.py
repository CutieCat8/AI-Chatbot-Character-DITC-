"""embedding dim 1536 to 1024 for e5-large

Revision ID: 8d76d39db984
Revises: 30d2a3b21df8
Create Date: 2026-09-02 11:39:21.344480
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy


# revision identifiers, used by Alembic.
revision: str = '8d76d39db984'
down_revision: Union[str, None] = '30d2a3b21df8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # เปลี่ยน embedding provider จาก text-embedding-3-small (1536) เป็น multilingual-e5-large (1024)
    # (ดู docs/adr/embedding-model.md) ค่าเดิมในคอลัมน์เป็นของ FakeEmbedder ล้วน ๆ (สุ่ม ไม่มีความหมาย)
    # เพราะ EMBEDDING_PROVIDER=fake มาตลอด — ไม่ต้อง preserve ข้อมูลเดิม รีเซ็ตเป็น NULL แล้ว
    # reindex ใหม่ทั้งหมดด้วย app/scripts/reindex_embeddings.py หลัง migrate เสร็จ
    op.drop_index(
        'ix_document_chunks_embedding',
        table_name='document_chunks',
        postgresql_using='hnsw',
        postgresql_with={'m': 16, 'ef_construction': 64},
        postgresql_ops={'embedding': 'vector_cosine_ops'},
    )
    op.execute('ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024) USING NULL')
    op.create_index(
        'ix_document_chunks_embedding',
        'document_chunks',
        ['embedding'],
        unique=False,
        postgresql_using='hnsw',
        postgresql_with={'m': 16, 'ef_construction': 64},
        postgresql_ops={'embedding': 'vector_cosine_ops'},
    )


def downgrade() -> None:
    op.drop_index(
        'ix_document_chunks_embedding',
        table_name='document_chunks',
        postgresql_using='hnsw',
        postgresql_with={'m': 16, 'ef_construction': 64},
        postgresql_ops={'embedding': 'vector_cosine_ops'},
    )
    op.execute('ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1536) USING NULL')
    op.create_index(
        'ix_document_chunks_embedding',
        'document_chunks',
        ['embedding'],
        unique=False,
        postgresql_using='hnsw',
        postgresql_with={'m': 16, 'ef_construction': 64},
        postgresql_ops={'embedding': 'vector_cosine_ops'},
    )
