import asyncio
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.learning.contracts import LessonPlanDraft
from app.learning.models import (
    LearningConversation,
    LearningLessonPlan,
    LearningLessonRevision,
    LearningTurn,
)
from app.learning.plans import PlanSourceChanged, insert_plan, read_plan
from tests.test_knowledge import apply, draft, setup
from tests.test_learning_contracts import draft_data as draft_data
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate


@pytest.fixture
def example_conversation(account_app):
    app, client, knowledge, _, _ = setup(account_app)
    assert apply(client, knowledge, draft(client, knowledge)).status_code == 200
    section = knowledge.split("/")[-2]
    project = client.post("/api/v1/learning/projects", json={"section_id": section}).json()["data"]
    return app, client, UUID(project["conversation"]["id"])


@pytest.mark.parametrize("with_plan", [False, True])
def test_legacy_history_reads_unchanged(example_conversation, draft_data, with_plan):
    app, client, conversation_id = example_conversation
    path = f"/api/v1/learning/conversations/{conversation_id}"
    old_state = {
        "problem": "已知 f(x)=2x+1，求 f(3)。",
        "step": {
            "index": 2,
            "title": "第二步：代入",
            "content": "第 2 步：代入 x=3。",
            "final": True,
        },
        "complete": False,
        "check": "哪个量是输入？",
        "support": {"kind": "evaluate", "text": "已指出输入。"},
    }

    async def seed():
        async with app.state.resources.session() as db:
            db.add_all(
                [
                    LearningLessonRevision(
                        conversation_id=conversation_id,
                        revision=4,
                        request_id=uuid4(),
                        action="evaluate",
                        response="3",
                        state=old_state,
                    ),
                    LearningTurn(
                        conversation_id=conversation_id,
                        position=1,
                        request_id=uuid4(),
                        question="这里的 3 是什么？",
                        answer="它是输入。",
                    ),
                ]
            )
            if with_plan:
                conversation = await db.get(LearningConversation, conversation_id)
                await insert_plan(
                    db,
                    conversation_id=conversation_id,
                    knowledge_point_id=conversation.knowledge_point_id,
                    content_version_id=conversation.content_version_id,
                    draft=LessonPlanDraft.model_validate(draft_data),
                )
            await db.commit()

    asyncio.run(seed())
    assert client.get(path + "/lesson").json()["data"] == {"revision": 4, **old_state}
    turns = client.get(path + "/turns").json()["data"]["turns"]
    assert [(t["question"], t["answer"]) for t in turns] == [("这里的 3 是什么？", "它是输入。")]

    # Repeated reads preserve the legacy snapshot, even when this conversation has a new plan.
    assert client.get(path + "/lesson").json()["data"] == {"revision": 4, **old_state}
    authenticate(client, app, "other@example.com")
    assert client.get(path + "/lesson").status_code == 404
    assert client.get(path + "/turns").status_code == 404


def test_plan_round_trip_is_scoped_and_joins_the_callers_transaction(
    example_conversation, draft_data
):
    app, _, conversation_id = example_conversation

    async def run():
        async with app.state.resources.session() as db:
            conversation = await db.get(LearningConversation, conversation_id)
            source = {
                "conversation_id": conversation_id,
                "knowledge_point_id": conversation.knowledge_point_id,
                "content_version_id": conversation.content_version_id,
                "draft": LessonPlanDraft.model_validate(draft_data),
            }
            with pytest.raises(PlanSourceChanged):
                await insert_plan(db, **(source | {"content_version_id": uuid4()}))
            with pytest.raises(PlanSourceChanged):
                await insert_plan(db, **(source | {"knowledge_point_id": uuid4()}))

            first = await insert_plan(db, **source)
            second = await insert_plan(db, **source)
            await db.commit()
            assert first.plan_id != second.plan_id
            assert first.question_id != second.question_id
            assert first.knowledge_point_id == source["knowledge_point_id"]

        async with app.state.resources.session() as db:
            assert (
                await read_plan(db, conversation_id=conversation_id, plan_id=first.plan_id) == first
            )
            assert (
                await read_plan(db, conversation_id=conversation_id, plan_id=second.plan_id)
                == second
            )
            assert await read_plan(db, conversation_id=uuid4(), plan_id=first.plan_id) is None
            record = await db.get(LearningLessonPlan, first.plan_id)
            assert record.content_version_id == source["content_version_id"]
            pending = await insert_plan(db, **source)
            await db.rollback()

        async with app.state.resources.session() as db:
            assert (
                await read_plan(db, conversation_id=conversation_id, plan_id=pending.plan_id)
                is None
            )
            assert await db.scalar(select(LearningLessonRevision)) is None
            assert await db.scalar(select(LearningTurn)) is None

    asyncio.run(run())
