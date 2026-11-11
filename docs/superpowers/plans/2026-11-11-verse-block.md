# 말씀 블록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 놀이터의 두 번째 게임 '말씀 블록'을 추가한다. 구절을 단어 블록으로 나눠 그룹 멤버에게 분배하고, 함께 문장 줄을 완성한다. 확인 방식은 A(칸마다 바로 확인)와 B(다 채우고 제출)이며, 라운드마다 고를 수 있다.

**Architecture:** 퍼즐은 건드리지 않는다. 판정 규칙은 순수 함수 모듈 `games/verse/logic.js`에 두고, Socket.IO 네임스페이스 `/verse`의 서버(`games/verse/server.js`)가 방·관리자·플레이어·그룹·재입장·접속 표시를 퍼즐 서버와 같은 패턴으로 처리한다. 화면은 `public/verse/`에 두고 퍼즐의 `theme.css`와 `core.js`를 재사용한다.

**Tech Stack:** Node.js, Express 4, Socket.IO 4, 바닐라 JS/CSS, 테스트는 node + socket.io-client(+assert), Playwright(브라우저)

**Spec:** `docs/superpowers/specs/2026-11-11-verse-block-design.md`

## Global Constraints

- 퍼즐 관련 파일(`games/puzzle/*`, `public/puzzle/*`)은 수정하지 않는다. 읽기 재사용만 한다(`/puzzle/theme.css`, `/puzzle/core.js`).
- 관리자 비밀번호는 환경 변수 `ADMIN_PASSWORD`(기본값 `admin`), 방 코드는 4자리 숫자, 플레이어 비밀번호는 숫자 4자리, 이름은 최대 10자.
- 최대 플레이어 60명, 그룹 1~10개, 구절 목록 최대 20개, 구절당 블록 최대 30개.
- 블록 나누기: 본문에 `/`가 있으면 `/` 기준, 없으면 띄어쓰기 기준.
- B 방식에서 틀리면 그룹에 틀린 개수만 알리고 5초(5000ms) 동안 다시 제출할 수 없다.
- 틀린 칸에 넣었을 때 안내 문구를 띄우지 않는다(A 방식).
- 실시간 전송: 블록 변경분만 그 그룹과 관리자에게 보내고, 전체 상태는 구조가 바뀔 때만 보낸다. 플레이어 상태에는 자기 그룹 데이터만 담는다.
- 화면 문구는 한국어, 디자인은 CODE:Block 테마.

## Review Focus

1. **정답 유출:** 플레이어가 받는 상태와 블록 id로 정답 순서를 알 수 있으면 안 된다. 구절 본문은 관리자에게만 보내고, 블록 id는 정답 순서와 무관하게 섞는다. → Task 2 테스트 `플레이어 상태에 구절 본문 없음`, Task 1 테스트 `블록 id가 정답 순서와 다름`.
2. **같은 글자 블록:** 같은 단어가 두 번 나오면 어느 칸에 넣어도 정답으로 처리해야 한다(A 고정, B 판정 모두). → Task 1 `countWrong 같은 글자 교환`, Task 2 `A 방식 같은 글자 블록 고정`.
3. **내보낸 친구 블록이 칸에 남아 막힘:** 내보낸 플레이어의 블록이 칸에 남아 있으면 아무도 뺄 수 없어 B 방식이 진행되지 않는다. 칸에 있는 블록도 주인을 그룹 멤버에게 넘긴다. → Task 2 `내보내기: 칸에 있는 블록 주인도 넘김`.
4. **동시에 같은 칸에 넣기:** 두 아이가 거의 동시에 같은 빈칸에 넣으면 먼저 처리된 하나만 들어가야 한다. → Task 2 `찬 칸에 넣기 거부`.
5. **블록보다 멤버가 많은 그룹, 사람 없는 그룹:** 블록이 없는 멤버는 도우미 안내를 받고, 사람이 없는 그룹은 진행하지 않는다. → Task 2 `블록 없는 멤버 / 빈 그룹 비활성`.

---

### Task 1: 판정 규칙 모듈

**Files:**
- Create: `games/verse/logic.js`
- Test: `test/verse-logic.js`

**Interfaces:**
- Produces:
  - `splitBlocks(text: string) -> string[]`: 앞뒤 공백을 제거하고, 빈 블록은 뺀다.
  - `makeBlocks(words: string[]) -> {id:number,text:string}[]`: 배열을 섞고, id도 0..n-1을 섞어서 붙인다.
  - `slotIsCorrect(answer: string[], slot: number, text: string) -> boolean`
  - `countWrong(answer: string[], placed: {slot:number,text:string}[]) -> number`: 정답과 다른 칸 수.
  - `LIMITS = { maxBlocks: 30, maxVerses: 20 }`

- [ ] **Step 1: Write the failing tests** (`test/verse-logic.js`, node assert)
  - `splitBlocks('말 한마디가  누군가의 인생을')` → `['말','한마디가','누군가의','인생을']`
  - `splitBlocks('말 한마디가 / 누군가의 인생을 / 바꿀 수 있어요')` → `['말 한마디가','누군가의 인생을','바꿀 수 있어요']`
  - `splitBlocks(' / a // b / ')` → `['a','b']`
  - `makeBlocks(['a','b','c','d','e','f','g','h'])`: 글자 집합이 같고, 20번 만들었을 때 id 순서가 정답 순서(0,1,2…)와 같은 경우가 한 번도 없음 → 테스트 이름 `블록 id가 정답 순서와 다름`
  - `slotIsCorrect(['나','는','나'], 2, '나') === true`
  - `countWrong(['a','b','a'], [{slot:0,text:'a'},{slot:1,text:'b'},{slot:2,text:'a'}]) === 0`, `countWrong(['a','b','c'], [{slot:0,text:'b'},{slot:1,text:'a'},{slot:2,text:'c'}]) === 2` → 이름 `countWrong 같은 글자 교환`
- [ ] **Step 2: Run** `node test/verse-logic.js` → FAIL (모듈 없음)
- [ ] **Step 3: Implement** `games/verse/logic.js`. id 섞기: n≥2이면 항등 순열이 나오지 않을 때까지 다시 섞는다.
- [ ] **Step 4: Run** `node test/verse-logic.js` → 모든 테스트 통과
- [ ] **Step 5: Commit** `feat(verse): 블록 나누기·판정 규칙 모듈`

### Task 2: 말씀 블록 서버

**Files:**
- Create: `games/verse/server.js`
- Modify: `server.js` (등록 한 줄: `require('./games/verse/server')(io.of('/verse'))`)
- Test: `test/verse-sim.js`
- Modify: `package.json` scripts: `"test": "node test/sim.js && node test/verse-logic.js && node test/verse-sim.js"`

**Interfaces:**
- Consumes: Task 1 `splitBlocks, makeBlocks, slotIsCorrect, countWrong, LIMITS`.
- Produces (Socket.IO `/verse` 이벤트, 응답은 콜백 `{ok, error?}`):
  - 관리자 이벤트(퍼즐과 이름·동작 동일): `admin:login {password}`, `admin:create → {code, adminKey}`, `admin:resume {code, adminKey}`, `admin:settings {groups}`, `admin:rename {group, name}`, `admin:move {pid, group}`, `admin:kick {pid}`, `admin:reset`, `admin:close`
  - 관리자 새 이벤트:
    - `admin:addVerse {text, ref} → {ok, id}`: 블록 0개 또는 30개 초과면 거부. 20개가 넘으면 가장 오래된 것부터 지운다.
    - `admin:deleteVerse {id}`
    - `admin:round {verseId?, mode?:'instant'|'submit'}`: 대기실에서만.
    - `admin:start`: 구절이 없거나 그룹 고른 사람이 없으면 거부.
    - `admin:hint {ref?:boolean, first?:boolean}`
  - 서버→관리자: `verses {items:[{id,text,ref,blocks}], current}`
  - 플레이어 이벤트: `p:check {code}`, `p:join {code,name,pin} → {ok,pid,rejoined}`, `p:group {group}`, `p:leave`
    - `p:place {blockId, slot} → {ok, locked}`: 칸이 비어 있어야 함. A 방식은 맞으면 `locked=true`.
    - `p:unplace {blockId} → {ok}`: 고정된 블록은 거부.
    - `p:submit → {ok, correct, wrong, cooldownMs}`: B 방식에서 모든 칸이 찼고 쿨다운이 끝났을 때만.
  - 서버→클라이언트:
    - `state` (view별): `{code,status,settings:{groups},round:{mode,slots,ref?,first?:string[]},players:[{pid,name,color,group,online,assigned,left}],groups:[{index,name,active,blocks:[{id,text,owner,slot,locked}],total,lockedCount,filledCount,finishedAt,rank,cooldownUntil,lastWrong}],startedAt,serverNow}`
      - 관리자만 `round.verse = {text, ref, blocks}`를 받는다.
      - `ref`는 힌트가 켜졌을 때만, `first`(칸별 첫 글자)는 첫 글자 힌트가 켜졌을 때만 들어간다.
    - `block {g, b:{id,owner,slot,locked}}`: 그 그룹과 관리자에게만.
    - `done {group, rank, by}`: 그룹 완성, 그 그룹과 관리자에게.
    - `locked {group, blockId, by}`: A 방식에서 고정될 때.
    - `submitted {group, by, correct, wrong}`: B 방식 제출 결과.
    - `presence {pid, online}`, `kicked`, `closed`

- [ ] **Step 1: Write the failing scenario tests** (`test/verse-sim.js`, 퍼즐 `test/sim.js`와 같은 형식). 꼭 넣을 테스트 이름:
  - `관리자 로그인 전 방 만들기 거부`, `구절 추가: / 기준 블록 3개`, `블록 0개·31개 구절 거부`
  - `플레이어 상태에 구절 본문 없음`: 플레이어 `state`의 JSON에 구절 본문 문자열이 없음. `round.verse` 없음.
  - `참조 힌트 켜면 플레이어에게 ref 표시`, `첫 글자 힌트 켜면 first 배열 길이 = 칸 수`
  - `블록 분배: 그룹 안 차이 1 이하`, `블록 없는 멤버 / 빈 그룹 비활성`
  - `남의 블록 넣기 거부`, `찬 칸에 넣기 거부`
  - `A 방식 맞는 칸 고정`, `A 방식 틀린 칸은 고정 안 됨`, `A 방식 같은 글자 블록 고정`, `고정 블록 빼기 거부`, `A 방식 모두 고정 → 완성·순위`
  - `B 방식 빈칸 있으면 제출 거부`, `B 방식 틀리면 틀린 개수 + 5초 쿨다운`, `쿨다운 중 제출 거부`, `B 방식 모두 맞으면 완성`
  - `재입장하면 블록 그대로`, `내보내기: 칸에 있는 블록 주인도 넘김`, `다음 라운드: 그룹·구절 목록 유지`
  - `플레이어는 자기 그룹 블록만 받음`
- [ ] **Step 2: Run** `node server.js & node test/verse-sim.js` → FAIL (`/verse` 없음)
- [ ] **Step 3: Implement** `games/verse/server.js`
  - 방·관리자·플레이어·그룹·재입장·presence·view별 브로드캐스트는 `games/puzzle/server.js`의 패턴을 그대로 따른다(`viewOf`, `eachSocket`, `broadcast`, `toGroup`, `sendPresence`).
  - 게임 데이터: `room.verses`, `room.round={verseId,mode}`, `room.hint={ref,first}`. 그룹별 `blocks`, `finishedAt`, `rank`, `cooldownUntil`, `lastWrong`.
  - 시작할 때 `makeBlocks(verse.blocks)`를 그룹마다 따로 만들어 멤버에게 round-robin으로 나눈다.
  - 완성 판정: A는 모든 블록이 `locked`일 때, B는 `countWrong === 0`일 때(모두 locked로 바꿈).
  - 내보내기: 그 사람의 블록(칸 안 포함)을 남은 멤버 중 블록이 가장 적은 사람에게 넘긴다.
- [ ] **Step 4: Run** `node test/verse-logic.js && node test/verse-sim.js` and `node test/sim.js` (퍼즐 회귀) → 모두 통과
- [ ] **Step 5: Commit** `feat(verse): 말씀 블록 서버와 시나리오 테스트`

### Task 3: 플레이어 화면

**Files:**
- Create: `public/verse/index.html`, `public/verse/player.js`, `public/verse/player.css`

**Interfaces:**
- Consumes: Task 2 이벤트. `/puzzle/theme.css`, `/puzzle/core.js`의 `PZ.$, el, toast, sound, store, confetti, fmtTime`.
- 저장 키: `vb-session` (`{code,name,pin}`)

- [ ] **Step 1: 화면 구성:** 입장 코드 → 이름·비밀번호 → 그룹 선택(결정 → 확인 창 → 수락) → 대기 → 게임. 퍼즐 플레이어 화면과 같은 흐름·문구이고, 제목은 `말씀 블록`, 위에 작은 `CODE:Block`을 표시한다.
- [ ] **Step 2: 게임 화면**
  - 위: 문장 줄. 번호 붙은 칸이 줄바꿈되며 이어지고, 칸에 든 블록은 넣은 사람의 색 테두리와 이름으로 표시한다. 고정된 칸은 초록색이다. 힌트로 참조와 칸별 첫 글자를 보여준다.
  - 아래: 내 블록.
  - 블록을 누르면 선택되고, 빈칸을 누르면 `p:place`. 끌어서 칸에 놓아도 `p:place`.
  - 내가 넣은 고정 안 된 블록을 누르면 `p:unplace`.
  - B 방식: 모든 칸이 차면 `제출` 버튼을 켠다. 결과는 `submitted`로 그룹 전체에 "N개가 틀렸어요"를 보여주고 남은 쿨다운 초를 표시한다.
  - 블록이 0개인 멤버에게는 `친구들을 도와주세요! 문장을 같이 읽어 보세요` 안내를 띄운다.
  - 완성되면 축하 창에 순위, 완성 구절(칸 순서대로 이은 문장), 참조를 보여준다.
- [ ] **Step 3: 확인:** 서버를 켜고 Playwright로 휴대폰 화면 2개를 열어 입장 → 그룹 → 대기까지 진행된다. 콘솔 오류 0개.
- [ ] **Step 4: Commit** `feat(verse): 플레이어 화면`

### Task 4: 관리자 화면과 허브 카드

**Files:**
- Create: `public/verse/admin.html`, `public/verse/admin.js`, `public/verse/admin.css`
- Modify: `public/index.html` ('준비 중' 카드 → 말씀 블록 카드: `플레이어 입장` `/verse/`, `관리자` `/verse/admin.html`)

**Interfaces:**
- Consumes: Task 2 관리자 이벤트, `/api/qr?game=verse&code=`.
- 저장 키: `vb-admin` (`{code, adminKey}`)

- [ ] **Step 1: 대기실:** 로그인/방 만들기/이어서 관리하기, QR 카드(QR 크게 보기), 그룹 수, 그룹 이름 수정, 참가자 보드(옮기기·내보내기)를 퍼즐 관리자와 같은 배치로 만든다.
- [ ] **Step 2: 구절 관리:**
  - 본문과 참조를 입력하면 블록 미리보기가 실시간으로 나오고, `추가` 버튼이 있다.
  - 구절 목록에서 이번 라운드 구절을 고르고, 삭제할 수 있다.
  - 확인 방식은 A `칸마다 바로 확인` / B `다 채우고 제출` 중에서 고른다.
- [ ] **Step 3: 게임 중:**
  - 그룹 카드마다 문장 줄을 실시간으로 보여준다(넣은 사람 색, 고정 표시). B 방식이면 마지막 제출 결과도 보여준다.
  - 진행률과 멤버별 남은 블록을 보여준다.
  - 힌트 버튼: `참조 보여주기`, `첫 글자 보여주기`, `구절 크게 보기`(관리자 화면 전용 오버레이).
  - `locked`/`done` 수신 시 띠링/팡파르 소리를 낸다(소리 켜기 체크박스).
  - 순위 띠, `게임 끝내기`/`다음 라운드 준비`.
- [ ] **Step 4: 확인:** Playwright로 관리자 화면에서 구절 추가 → 라운드 선택 → 시작까지 콘솔 오류 0개. 허브 카드 링크가 동작한다.
- [ ] **Step 5: Commit** `feat(verse): 관리자 화면과 허브 카드`

### Task 5: 통합 검증과 문서

**Files:**
- Create: `test/verse-load.js`
- Modify: `README.md` (말씀 블록 사용법, 테스트 명령)

- [ ] **Step 1: 브라우저 E2E:**
  - 관리자 1명과 휴대폰 2명이 같은 그룹에서 진행한다.
  - A 방식: 누르기와 끌기로 끝까지 완성한다.
  - B 방식: 다음 라운드에서 일부러 틀리게 제출해 "N개가 틀렸어요"와 쿨다운을 확인한 뒤 고쳐서 완성한다.
  - 힌트 2종이 플레이어 화면에 나오는지 확인한다. 콘솔 오류 0개. 스크린샷을 남긴다.
- [ ] **Step 2: 부하 테스트** `test/verse-load.js`:
  - 조건: 50명·8그룹·12블록 구절, `cpulimit -l 10`(0.1코어).
  - 통과 기준: 응답 p99 ≤ 50ms, 끊김 0, 1분 전송량 ≤ 20MB.
- [ ] **Step 3: README 갱신**
- [ ] **Step 4: Run** `npm test` (퍼즐 + 말씀 블록) → 모두 통과
- [ ] **Step 5: Commit** `test(verse): 부하·브라우저 검증, README`
