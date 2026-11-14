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


def test_textbook_groups_projects_and_exposes_unopened_sections(account_app):
    app, client = account_app
    owner_cookie = authenticate(client, app)
    course, (section, empty_section, unopened_section) = seed_sections(client, 3)
    assert (
        client.patch(f"/api/v1/courses/{course}", json={"textbook": "线性代数教材"}).status_code
        == 200
    )
    textbooks = f"{PROJECTS}/textbooks"
    outline = f"{textbooks}/{course}"
    assert client.get(textbooks).json()["data"]["items"] == [
        {"id": course, "title": "线性代数教材"}
    ]
    assert client.get(outline).status_code == 200
    assert client.get(PROJECTS).json()["data"]["items"] == []
    first = client.post(PROJECTS, json={"section_id": section}).json()["data"]
    client.post(PROJECTS, json={"section_id": empty_section})
    assert client.get(textbooks).json()["data"] == {
        "items": [{"id": course, "title": "线性代数教材"}],
        "next_cursor": None,
    }
    knowledge = f"/api/v1/sections/{unopened_section}/knowledge-points"
    payload = deepcopy(PAYLOAD)
    payload["knowledge_points"].append(
        dict(payload["knowledge_points"][0], temp_id="kp_002", title="函数的应用")
    )
    draft = knowledge_draft(client, knowledge, payload)
    chapter = client.get(outline).json()["data"]["chapters"][0]
    assert chapter["id"] == first["chapter_id"]
    assert chapter["title"] == "第一章"
    assert [item["id"] for item in chapter["sections"]] == [
        section,
        empty_section,
        unopened_section,
    ]
    assert all(not item["knowledge_points"] for item in chapter["sections"])
    assert apply_knowledge(client, knowledge, draft).status_code == 200
    items = client.get(outline).json()["data"]["chapters"][0]["sections"][-1]["knowledge_points"]
    assert [(item["title"], item["studied"]) for item in items] == [
        ("函数的定义", False),
        ("函数的应用", False),
    ]
    assert len(client.get(PROJECTS).json()["data"]["items"]) == 2
    response = client.post(
        PROJECTS, json={"section_id": unopened_section, "knowledge_point_id": items[1]["id"]}
    )
    assert response.status_code == 200
    assert response.json()["data"]["conversation"]["knowledge_point_id"] == items[1]["id"]
    assert client.get(textbooks, params={"before": "invalid"}).status_code == 422
    authenticate(client, app, "other@example.com")
    assert client.get(textbooks).json()["data"]["items"] == []
    assert client.get(outline).status_code == 404
    client.cookies.set("learning_session", owner_cookie)
    assert client.patch(f"/api/v1/courses/{course}", json={"status": "archived"}).status_code == 200
    assert client.get(outline).status_code == 404


def test_textbook_cursor_pages_courses_instead_of_sections(account_app):
    app, client = account_app
    authenticate(client, app)
    courses = []
    for _ in range(7):
        course, sections = seed_sections(client, 2)
        for section in sections:
            assert client.post(PROJECTS, json={"section_id": section}).status_code == 200
        courses.append(course)
    path = f"{PROJECTS}/textbooks"
    first = client.get(path).json()["data"]
    assert [item["id"] for item in first["items"]] == courses[:0:-1]
    second = client.get(path, params={"before": first["next_cursor"]}).json()["data"]
    assert second == {"items": [{"id": courses[0], "title": "线性代数"}], "next_cursor": None}
