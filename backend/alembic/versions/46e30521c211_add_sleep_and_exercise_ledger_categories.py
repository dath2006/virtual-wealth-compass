"""add sleep and exercise ledger categories

Revision ID: 46e30521c211
Revises: f0465acc6410
Create Date: 2026-06-11 16:39:43.614972

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '46e30521c211'
down_revision: Union[str, None] = 'f0465acc6410'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE ledgercategory ADD VALUE 'SLEEP_EVENT'")
        op.execute("ALTER TYPE ledgercategory ADD VALUE 'EXERCISE_INCOME'")


def downgrade() -> None:
    pass

