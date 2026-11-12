# 놀이터 통합 세션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 번 입장한 방에서 퍼즐과 말씀 블록을 재입장 없이 오가게 하고, 말씀 블록 힌트를 '전체 글자 보여주기'로 바꾼다.

**Architecture:** Socket.IO 네임스페이스 `/play`를 하나만 둔다. 방·관리자·플레이어·그룹·재입장·접속 표시는 공통 서버 `games/session/server.js`가 맡는다. 게임 규칙은 모듈 `games/puzzle/game.js`, `games/verse/game.js`가 맡는다. 클라이언트도 공통 페이지(`/play/`, `/play/admin.html`)와 게임별 스크립트로 나눈다. 기존 두 게임의 코드와 테스트를 옮겨 오는 리팩터링이며, 게임 화면과 규칙은 바꾸지 않는다(말씀 힌트 제외).

**Tech Stack:** Node.js, Express 4, Socket.IO 4, 바닐라 JS/CSS. 테스트는 node + socket.io-client + assert, 브라우저 확인은 Playwright(스크래치).

**Spec:** `docs/superpowers/specs/2026-11-12-unified-session-design.md`

## Global Constraints

- 작업은 `verse-block` 브랜치(PR #1)에서만 한다. `main`은 건드리지 않는다. 사용 목표는 2026-11-15(일)이다.
- 그대로 유지할 값: 관리자 비밀번호 `ADMIN_PASSWORD`(기본 `admin`), 방 코드 4자리, 비밀번호 숫자 4자리, 이름 최대 10자, 최대 60명, 그룹 1~10개.
- 퍼즐 값: 크기 2~8, 모양 square/triangle/mixed, 투명도 0.1~1, 정답 거리 0.45, 올린 사진 최대 12장.
- 말씀 블록 값: 구절 최대 20개, 블록 최대 30개, B 방식 쿨다운 5000ms.
- 이벤트 이름은 스펙 §4 '이벤트 이름'을 그대로 따른다.
  - 공통: `admin:*`, `p:*`
  - 퍼즐: `puzzle:*`
  - 말씀 블록: `verse:*`
- 말씀 힌트 필드: `round.words`. 전체 글자 힌트가 켜졌을 때만 칸별 정답 단어 배열을 보낸다. `round.first`는 없앤다.
- 성능 장치는 그대로 유지한다: 변경분만 전송, 그룹별 데이터 분리, 재접속 시 사진 재전송 생략(imageVer), presence 이벤트.
- 안정성 장치도 그대로 유지한다: 잘못된 payload는 `{}`로 바꾸고, 핸들러 오류는 기록만 하며, 서버 전체 `uncaughtException` 가드를 둔다.
- 화면 문구는 한국어, 디자인은 CODE:Block 테마(theme.css)다.

## Review Focus

1. **다른 게임의 이벤트:** 말씀 블록이 진행 중일 때 `puzzle:move` 등이 오면 거부해야 한다. 거꾸로도 마찬가지다. → Task 2 테스트 `다른 게임 이벤트 거부`
2. **게임 중 재입장:** 재입장하면 지금 진행 중인 게임 화면으로 돌아와야 한다(퍼즐 ↔ 말씀 혼동 없음). → Task 2 `재입장하면 진행 중인 게임 상태 받음`, Task 3 브라우저 확인
3. **게임 중 게임 변경 시도:** 관리자가 진행 중에 `admin:game`을 보내면 거부해야 한다. → Task 2 `진행 중 게임 변경 거부`
4. **예전 주소로 들어오기:** `/puzzle/?code=1234`로 들어오면 `/play/?code=1234`로 코드를 유지한 채 이동해야 한다. → Task 4 브라우저 확인
5. **다음 게임 준비 후 데이터:** 퍼즐 조각이나 말씀 블록이 다음 게임 상태에 남으면 안 된다. 그룹·이름·사진 목록·구절 목록은 남아야 한다. → Task 2 `다음 게임 준비: 게임 데이터 정리, 공통 데이터 유지`

---

### Task 1: 공통 세션 서버 + 퍼즐 모듈

**Files:**
- Create: `games/session/server.js`, `games/puzzle/game.js`
- Modify: `server.js` (`/play` 등록. 이 Task에서는 `/puzzle`, `/verse` 등록을 그대로 둠)
- Test: `test/puzzle-sim.js` (`test/sim.js` 내용을 `/play`와 새 이벤트 이름으로 옮김), `test/session-helpers.js`

**Interfaces:**
- Produces:
  - `registerSession(nsp, games: {[id]: GameModule})` (`games/session/server.js`의 기본 export)
  - `GameModule = { id, title, createState(): object, start(ctx, room, membersByGroup: string[][]): {ok, error?}, groupData(room, gi): object, groupView(room, gi, full: boolean): object, roundView(room, view): object, playerStats(room, player): {assigned,left,placed}, onKick(ctx, room, pid, gi): void, onReset(room): void, onJoin?(ctx, room, socket, data): void, adminEvents: {[ev]: (ctx, room, data, cb, socket) => void}, playerEvents: {[ev]: (ctx, room, player, data, cb, socket) => void} }`
  - `ctx = { broadcast(room), toGroup(room, gi, ev, data), toAdmins(room, ev, data), toRoom(room, ev, data), finishGroup(room, gi, by), reply(cb, data) }`
  - 방 객체: `room = { code, adminKey, status, game, settings:{groups}, groupNames, players: Map, groups: [{active, finishedAt, rank, ...게임 데이터}], startedAt, data: {puzzle:{…}, verse:{…}} }`
  - 상태 형식: 스펙 §4 '상태'
  - `test/session-helpers.js`: `connect(url)`, `emit(s, ev, d)`, `wait(ms)`, `ok(cond, msg)`, `adminRoom(url, game) → {admin, code, adminKey, st()}`. `st()`는 `state`, `*:piece`/`*:block`, `presence` 변경분을 반영한 관리자 상태다.
- 퍼즐 모듈 이벤트 매핑:
  - `admin:settings`의 rows/cols/shape/opacity → `puzzle:settings`
  - `admin:image|useImage|deleteImage|hint` → `puzzle:image|useImage|deleteImage|hint`
  - `p:move|rotate` → `puzzle:move|rotate`
  - 서버→ `piece|placed|image|library` → `puzzle:piece|placed|image|library`

- [ ] **Step 1: Write the failing test**
  - `test/sim.js`의 시나리오 49개를 `test/puzzle-sim.js`로 옮긴다. 관리자는 `admin:create` 다음에 `admin:game {id:'puzzle'}`를 보낸다.
  - 기존 테스트 이름은 그대로 두고, 아래 하나를 추가한다:
    - `관리자 게임 선택: puzzle`: `st().game === 'puzzle'`
- [ ] **Step 2: Run** `node server.js & node test/puzzle-sim.js` → FAIL (`/play` 없음, 응답 없음)
- [ ] **Step 3: Implement**
  - `games/session/server.js`: 이벤트 래퍼 `on(ev, fn)`는 null payload를 `{}`로 바꾸고 try/catch한다.
  - 게임 이벤트 전달:
    - 이름이 `<id>:`로 시작하면 `room.game === id`일 때만 그 모듈 처리기를 부른다.
    - 대기실 설정 이벤트(관리자 `puzzle:settings|image|useImage|deleteImage`, `verse:add|delete|round`)는 그 게임이 선택되지 않았어도 대기실에서 허용한다.
    - 플레이어 게임 이벤트는 `status==='playing' && room.game===id`일 때만 허용한다.
  - `games/puzzle/game.js`는 `games/puzzle/server.js`의 게임 규칙을 옮긴 것이다.
- [ ] **Step 4: Run** `node test/puzzle-sim.js` → `퍼즐 테스트 통과 (50개)`. `node test/sim.js`(기존 `/puzzle`)도 통과해야 한다.
- [ ] **Step 5: Commit** `refactor(session): 공통 세션 서버와 퍼즐 모듈`

### Task 2: 말씀 블록 모듈 + 게임 전환

**Files:**
- Create: `games/verse/game.js`
- Test: `test/verse-sim.js`를 `/play`와 `verse:*` 이벤트로 옮김, `test/session-sim.js`(새로 만듦)
- Modify: `server.js` (`/play`에 verse 모듈 추가)

**Interfaces:**
- Consumes: Task 1 `registerSession`, `GameModule`, `ctx`, `test/session-helpers.js`
- Produces:
  - 말씀 모듈 이벤트:
    - 관리자: `verse:add {text,ref}→{ok,id}`, `verse:delete {id}`, `verse:round {verseId?,mode?}`, `verse:hint {ref?:bool, words?:bool}`
    - 플레이어: `verse:place|unplace|submit`
    - 서버→ `verse:list|block|locked|submitted|done`
  - `round.words`: 전체 글자 힌트가 켜졌을 때 칸별 정답 단어 배열.

- [ ] **Step 1: Write the failing tests**
  - `test/verse-sim.js` 39개를 옮긴다. `첫 글자 힌트` 테스트는 아래로 바꾼다:
    - `전체 글자 힌트 켜면 words = 정답 단어 배열`: `deepStrictEqual(p0.st.round.words, '나 는 나 를 사랑 해'.split(' '))`
    - `힌트 끄면 words 없음`
  - 새 `test/session-sim.js`. 테스트 이름:
    - `한 번 입장으로 퍼즐 → 말씀 블록 → 퍼즐 진행 (재입장 없음)`: 같은 소켓과 같은 pid로 세 판을 끝까지 진행하고, 매 판 `status==='done'`인지 확인한다.
    - `그룹과 그룹 이름이 게임을 바꿔도 유지`
    - `다른 게임 이벤트 거부`: 말씀 진행 중 `puzzle:move`, `puzzle:rotate`가 `ok:false`이고, 퍼즐 진행 중 `verse:place`, `verse:submit`이 `ok:false`
    - `진행 중 게임 변경 거부`: playing 중 `admin:game {id:'verse'}` 이후에도 `st().game === 'puzzle'`
    - `대기실에서 게임 고르면 플레이어 상태의 game 변경`
    - `다음 게임 준비: 게임 데이터 정리, 공통 데이터 유지`: reset 후 그룹마다 `pieces`/`blocks`가 비어 있고, 그룹 이름·사진 목록 수·구절 목록 수는 유지
    - `재입장하면 진행 중인 게임 상태 받음`: 말씀 진행 중 끊었다가 재입장하면 `state.game==='verse'`이고 자기 그룹 블록을 받음
    - `퍼즐 사진은 대기실에서 퍼즐을 안 골라도 올릴 수 있음`
- [ ] **Step 2: Run** `node test/verse-sim.js; node test/session-sim.js` → FAIL (verse 모듈 없음)
- [ ] **Step 3: Implement** `games/verse/game.js`
  - `games/verse/server.js`의 규칙을 옮긴다(완성 그룹 참조 공개, 마지막 멤버 내보내기 처리 포함).
  - 힌트를 `words`로 바꾼다. `admin:game`·`admin:reset`은 공통 서버에서 처리한다.
- [ ] **Step 4: Run** `node test/puzzle-sim.js && node test/verse-logic.js && node test/verse-sim.js && node test/session-sim.js` → 모두 통과
- [ ] **Step 5: Commit** `feat(session): 말씀 블록 모듈과 게임 전환, 전체 글자 힌트`

### Task 3: 통합 플레이어 화면

**Files:**
- Create:
  - `public/play/index.html`, `public/play/player.js`
  - `public/play/puzzle-player.js`: `public/puzzle/player.js`의 게임 부분
  - `public/play/verse-player.js`: `public/verse/player.js`의 게임 부분
  - `public/play/player.css`: 퍼즐·말씀 플레이어 CSS를 합친 것
- 재사용: `/puzzle/theme.css`, `/puzzle/core.js`

**Interfaces:**
- Consumes: Task 1·2 이벤트와 상태
- Produces:
  - 게임 화면 모듈 `window.PlayGames[id] = { mount(ctx), render(room, me), clear(), on: {[ev]: handler} }`
  - ctx: `{ socket, pid(), room(), toast, sound }`
  - 저장 키: `play-session` (`{code,name,pin}`)
- [ ] **Step 1: 공통 흐름**
  - 입장, 그룹 선택(결정 → 수락), 대기 화면은 기존 문구 그대로다. 제목은 `CODE:Block`, 부제는 `놀이터`.
  - 대기 화면에 `다음 게임: 🧩 퍼즐` 또는 `다음 게임: 📖 말씀 블록`을 표시한다(`room.game` 기준).
  - 재입장, 새로고침 자동 재입장, imageVer를 유지한다.
  - `kicked`, `closed`를 처리한다.
  - 방이 사라졌을 때: 자동 재입장이 실패하면 입장 코드 화면으로 가고 `방이 사라졌어요. 선생님께 새 입장 코드를 받아 주세요`를 띄운다.
- [ ] **Step 2: 게임 화면 전환**
  - `status`가 `playing` 또는 `done`이고 그룹이 활성이면 `PlayGames[room.game]` 화면을 보여준다.
  - 대기실로 돌아오면 `clear()`를 부르고 대기 화면을 보여준다.
  - 말씀 화면은 힌트를 `round.words`로 표시한다(빈칸에 흐리게 전체 단어).
- [ ] **Step 3: 확인** Playwright, 휴대폰 2대, 관리자는 소켓:
  - 퍼즐 한 판 → reset → 말씀 A 한 판을 페이지 새로고침 없이 끝까지 진행한다.
  - 말씀 진행 중 새로고침하면 말씀 화면으로 복구된다.
  - 콘솔 오류 0개.
- [ ] **Step 4: Commit** `feat(play): 통합 플레이어 화면`

### Task 4: 통합 관리자 화면, 허브, 예전 주소, 예전 코드 정리

**Files:**
- Create:
  - `public/play/admin.html`, `public/play/admin.js`
  - `public/play/puzzle-admin.js`, `public/play/verse-admin.js`
  - `public/play/admin.css`: 퍼즐·말씀 관리자 CSS를 합친 것
- Modify:
  - `public/index.html`: CODE:Block 카드 하나(플레이어 입장 `/play/`, 관리자 `/play/admin.html`)
  - `server.js`: `/puzzle`, `/verse` 네임스페이스 등록 제거
- Replace(이동 페이지만 남김): `public/puzzle/index.html`, `public/puzzle/admin.html`, `public/verse/index.html`, `public/verse/admin.html`
  - 이동은 `location.replace('/play/' + 파일 + location.search)`로 한다.
- Delete:
  - `games/puzzle/server.js`, `games/verse/server.js`
  - `public/puzzle/player.js|player.css|admin.js|admin.css`, `public/verse/player.js|player.css|admin.js|admin.css`
  - `test/sim.js`
  - 단, `public/puzzle/theme.css|core.js|presets.js`는 남긴다.

**Interfaces:**
- Consumes: Task 1·2 이벤트
- Produces:
  - 관리자 게임 패널 `window.AdminGames[id] = { title, mountLobby(el, ctx), renderLobby(room), renderGame(room), on: {[ev]: handler}, canStart(room): {ok, reason} }`
  - 저장 키: `play-admin`
- [ ] **Step 1: 공통 대기실**
  - 로그인, 방 만들기, 이어서 관리하기, QR, 참가자 보드, 그룹 수, 그룹 이름 수정을 넣는다.
  - `이번 게임` 탭(`🧩 퍼즐` / `📖 말씀 블록`)을 누르면 `admin:game`을 보내고, 그 게임의 설정 패널을 보여준다.
  - 방 사라짐 처리는 `main`의 `roomLost()`와 같은 동작이다.
- [ ] **Step 2: 게임 패널**
  - 퍼즐·말씀의 설정, 진행 화면, 힌트, 크게 보기를 기존 관리자 화면에서 옮긴다.
  - 말씀 힌트 버튼은 `🔤 전체 글자 보여주기` / `🔤 전체 글자 숨기기`, 이벤트는 `verse:hint {words}`.
  - 진행 중 버튼: 끝나면 `다음 게임 준비`, 진행 중이면 `게임 끝내기`.
- [ ] **Step 3: 정리**
  - 예전 파일을 지우고 이동 페이지를 넣는다.
  - `server.js`에서 예전 네임스페이스를 제거한다.
  - `package.json` test 스크립트: `node test/puzzle-sim.js && node test/verse-logic.js && node test/verse-sim.js && node test/session-sim.js`
- [ ] **Step 4: 확인**
  - `npm test`가 모두 통과한다.
  - Playwright: 관리자 화면에서 퍼즐 설정(사진 업로드 포함) → 시작 → 끝 → 다음 게임 준비 → 말씀 탭 → 구절 추가 → 시작까지 콘솔 오류 0개.
  - 예전 주소 `/puzzle/?code=1234` → `/play/?code=1234`
  - 허브 링크가 동작한다.
- [ ] **Step 5: Commit** `feat(play): 통합 관리자 화면, 허브·예전 주소 이동, 예전 서버 정리`

### Task 5: 부하·브라우저 통합 검증과 문서

**Files:**
- Modify: `test/load.js`(퍼즐), `test/verse-load.js` → `/play`와 새 이벤트로 옮김
- Modify: `README.md`(통합 흐름, 새 주소, 테스트 명령)

- [ ] **Step 1: 부하 테스트** CPU 0.1코어(`cpulimit -l 10`)에서 실행한다.
  - 대상: 퍼즐 50명·8그룹·5×7 mixed, 말씀 50명·8그룹 instant·submit
  - 통과 기준: p99 ≤ 50ms, 끊김 0
- [ ] **Step 2: 브라우저 E2E** 관리자 UI 1명 + 휴대폰 2명으로 진행한다.
  - 퍼즐 한 판(두 번 눌러 돌리기·끌기) → 다음 게임 준비 → 말씀 B 한 판(틀린 제출 → 쿨다운 → 완성)을 휴대폰 재입장 없이 끝까지 한다.
  - 전체 글자 힌트가 휴대폰에 보인다.
  - 서버를 재시작하면 관리자와 플레이어 모두 방 사라짐 안내가 뜬다.
  - 콘솔 오류 0개.
- [ ] **Step 3: README 갱신**
- [ ] **Step 4: Run** `npm test` → 모두 통과
- [ ] **Step 5: Commit** `test(play): 통합 부하·브라우저 검증, README`
