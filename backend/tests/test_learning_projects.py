from copy import deepcopy

from tests.test_curriculum import apply as apply_directory
from tests.test_curriculum import draft as directory_draft
from tests.test_knowledge import PAYLOAD
from tests.test_knowledge import apply as apply_knowledge
from tests.test_knowledge import draft as knowledge_draft
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate

PROJECTS = "/api/v1/learning/projects"


def seed_sections(client, count):
    course = client.post("/api/v1/courses", json={"title": "线性代数"}).json()["data"]["id"]
    directory = f"/api/v1/courses/{course}/curriculum"
    version = directory_draft(
        client,
        directory,
        {
            "chapters": [
                {
                    "id": "tmp-c",
                    "title": "第一章",
                    "sections": [{"id": f"tmp-s{i}", "title": f"小节 {i}"} for i in range(count)],
                }
            ]
        },
    )
    response = apply_directory(client, directory, version)
    assert response.status_code == 200, response.text
    mapping = response.json()["data"]["id_mapping"]
    return course, [mapping[f"tmp-s{i}"] for i in range(count)]


def test_add_open_resume_and_isolate_knowledge_point_placeholders(account_app):
    app, client = account_app
    assert client.get(PROJECTS).status_code == 401
    owner_cookie = authenticate(client, app)
    course, (section, empty_section) = seed_sections(client, 2)
    knowledge = f"/api/v1/sections/{section}/knowledge-points"
    payload = deepcopy(PAYLOAD)
    payload["knowledge_points"].append(
        dict(payload["knowledge_points"][0], temp_id="kp_002", title="函数的应用")
    )
    draft = knowledge_draft(client, knowledge, payload)
    assert apply_knowledge(client, knowledge, draft).status_code == 200
    first = client.post(PROJECTS, json={"section_id": section})
    assert first.status_code == 200, first.text
    first = first.json()["data"]
    open_path = f"{PROJECTS}/{first['id']}/open"
    one, two = first["knowledge_points"]
    assert [one["title"], two["title"]] == ["函数的定义", "函数的应用"]
    assert first["conversation"]["knowledge_point_id"] == one["id"]
    assert client.post(open_path, json={}).json()["data"]["conversation"] == first["conversation"]
    second = client.post(open_path, json={"knowledge_point_id": two["id"]}).json()["data"]
    assert second["conversation"]["id"] != first["conversation"]["id"]
    assert client.post(PROJECTS, json={"section_id": section}).json()["data"] == second
    assert client.post(open_path, json={"knowledge_point_id": empty_section}).status_code == 404
    assert [
        point["status"] for point in client.get(knowledge).json()["data"]["knowledge_points"]
    ] == ["NOT_STARTED", "NOT_STARTED"]
    assert (
        client.post(PROJECTS, json={"section_id": empty_section}).json()["data"]["conversation"]
        is None
    )

    authenticate(client, app, "other@example.com")
    assert client.get(PROJECTS).json()["data"]["items"] == []
    assert client.post(PROJECTS, json={"section_id": section}).status_code == 404
    assert client.post(open_path, json={}).status_code == 404

    client.cookies.set("learning_session", owner_cookie)
    course_path = f"/api/v1/courses/{course}"
    assert client.patch(course_path, json={"status": "archived"}).status_code == 200
    assert client.get(PROJECTS).json()["data"]["items"] == []
    assert client.post(open_path, json={}).status_code == 404
    assert client.patch(course_path, json={"status": "active"}).status_code == 200
    assert client.post(open_path, json={}).json()["data"]["conversation"] == second["conversation"]
    assert client.delete(course_path).status_code == 200
    assert client.get(PROJECTS).json()["data"]["items"] == []


def test_recent_pages_and_reopening_moves_project_to_top(account_app):
    app, client = account_app
    authenticate(client, app)
    _, sections = seed_sections(client, 10)
    ids = [
        client.post(PROJECTS, json={"section_id": section}).json()["data"]["id"]
        for section in sections
    ]
    first = client.get(PROJECTS).json()["data"]
    assert [item["id"] for item in first["items"]] == ids[::-1][:6]
    second = client.get(PROJECTS, params={"before": first["next_cursor"]}).json()["data"]
    assert [item["id"] for item in second["items"]] == ids[3::-1]
    assert second["next_cursor"] is None
    assert client.get(PROJECTS, params={"before": "invalid"}).status_code == 422
    assert client.post(f"{PROJECTS}/{ids[0]}/open", json={}).status_code == 200
    assert client.get(PROJECTS).json()["data"]["items"][0]["id"] == ids[0]
