import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine

from app.learning.contracts import LessonOperation, validate_model_output
from app.learning.lesson_generation import LessonGenerator
from app.learning.models import LearningLessonPlan
from tests import test_phase1
from tests.test_knowledge import apply, draft, setup
from tests.test_learning_contracts import PRACTICE_TYPES
from tests.test_learning_contracts import draft_data as draft_data


@pytest.mark.skipif(not os.getenv("LESSON_TEST_POSTGRES"), reason="requires isolated PostgreSQL")
def test_two_concurrent_starts_publish_one_plan(configured, tmp_path, draft_data, monkeypatch):
    url = os.environ["LESSON_TEST_POSTGRES"]
    monkeypatch.setattr(test_phase1, "create_async_engine", lambda _: create_async_engine(url))
    fixture = test_phase1.account_app.__wrapped__(configured, tmp_path)
    try:
        app, client = next(fixture)
        _, _, knowledge, _, _ = setup((app, client))
        assert apply(client, knowledge, draft(client, knowledge)).status_code == 200
        project = client.post(
            "/api/v1/learning/projects", json={"section_id": knowledge.split("/")[-2]}
        ).json()["data"]
        endpoint = f"/api/v1/learning/conversations/{project['conversation']['id']}/lesson/task"
        arrived = 0
        gate = asyncio.Event()

        async def generate(self, operation, context):
            nonlocal arrived
            if operation == LessonOperation.PRACTICE_PLAN:
                return validate_model_output(operation, PRACTICE_TYPES)
            if operation == LessonOperation.PLAN:
                arrived += 1
                if arrived == 2:
                    gate.set()
                await asyncio.wait_for(gate.wait(), timeout=5)
                return validate_model_output(operation, draft_data)
            return validate_model_output(operation, {"title": "主题", "content": "课程讲解"})

        monkeypatch.setattr(LessonGenerator, "generate", generate)

        def start(_):
            return client.post(
                endpoint,
                json={
                    "action": "start",
                    "expected_revision": 0,
                    "request_id": str(uuid4()),
                },
            )

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(start, range(2)))
        assert sorted(response.status_code for response in results) == [200, 409]
        winner = next(
            response.json()["data"] for response in results if response.status_code == 200
        )
        assert winner == client.get(endpoint).json()["data"]
        assert winner["status"] == "final_step"

        async def plan_count():
            async with app.state.resources.session() as db:
                return await db.scalar(select(func.count()).select_from(LearningLessonPlan))

        assert client.portal.call(plan_count) == 1
    finally:
        fixture.close()
