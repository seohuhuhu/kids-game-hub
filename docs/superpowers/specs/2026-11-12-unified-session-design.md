# 놀이터 통합 세션 – 설계 문서

작성일: 2026-11-12 · 상태: 검토 대기 · 사용 목표: 2026-11-15(일) 소년부 예배

## 1. 목적

- 아이들이 **한 번만 입장**하면, 방을 나가지 않은 채 **퍼즐(CODE:Block)**과 **말씀 블록**을 오가며 플레이할 수 있게 한다.
- 성공 기준
  - 입장(코드 → 이름·비밀번호 → 그룹)은 한 번만 하고, 게임을 바꿔도 다시 들어오지 않는다.
  - 그룹과 그룹 이름은 두 게임에서 그대로 이어진다.
  - 기존 두 게임의 기능과 테스트(퍼즐 49개, 말씀 블록 판정 8개 + 시나리오 39개)가 새 구조에서도 모두 통과한다.
  - 50명 동시 접속(CPU 0.1코어)에서 지금과 같은 수준(응답 수 ms, 끊김 0)을 유지한다.

## 2. 확정 사항 / 가정

| 구분 | 내용 |
|---|---|
| 확정 | 방 하나에서 관리자가 대기실에서 이번 게임(퍼즐/말씀 블록)을 고른다 |
| 확정 | 게임이 끝나면 '다음 게임 준비'로 대기실에 돌아가고, 아이들은 대기 화면에서 다음 게임을 기다린다 |
| 확정 | 그룹·그룹 이름은 두 게임이 함께 쓴다 (사용자 확인) |
| 확정 | 말씀 블록 힌트 '첫 글자 보여주기' → **'전체 글자 보여주기'** (빈칸마다 그 칸의 단어 전체를 흐리게 표시) |
| 확정 | 구조: 공통 방 관리 + 게임 모듈 2개 (사용자 선택 1번) |
| 확정 | 일요일에 쓰는 `main`은 통합 버전이 검증될 때까지 건드리지 않는다. PR #1 브랜치에서 작업하고 미리보기로 검증한 뒤 토요일에 합친다 |
| 가정 | 퍼즐과 말씀 블록 각각의 화면·규칙·디자인은 지금과 같다 (게임 화면 내용은 바꾸지 않음) |

## 3. 흐름

### 관리자 (`/play/admin.html`)
1. 관리자 비밀번호 로그인 → **방 만들기** → QR(`/play/?code=1234`)과 입장 코드.
2. 대기실 공통: QR 크게 보기, 참가자 보드(그룹 고르지 않은 친구 / 그룹별), 그룹 수, 그룹 이름 수정, 옮기기·내보내기.
3. **이번 게임 고르기**: `🧩 퍼즐` / `📖 말씀 블록` 탭. 고른 게임의 설정 패널이 나온다.
   - 퍼즐: 크기(가로×세로), 조각 모양, 친구 조각 투명도, 사진(기본 그림·첨부·올린 사진 목록·비율 추천), 사진 크게 보기
   - 말씀 블록: 구절 추가·목록, 확인 방식 A/B, 구절 크게 보기
4. **게임 시작** → 그 게임의 진행 화면(지금 화면 그대로). 힌트 버튼은 게임별로 다르다.
   - 퍼즐: 전체 힌트 켜기/끄기, 친구 조각 투명도 조절
   - 말씀 블록: 참조 보여주기, **전체 글자 보여주기**
5. **다음 게임 준비** → 대기실로. 플레이어·그룹·그룹 이름·올린 사진 목록·구절 목록은 유지된다.
6. 방이 사라지면(서버 재시작) "서버가 다시 시작되어 방이 사라졌어요" 안내와 함께 로그인 화면으로 돌아간다.

### 플레이어 (`/play/`)
1. 입장 코드 → 이름 + 비밀번호 → 그룹 선택(결정 → 수락) — 지금과 같다. 제목은 `CODE:Block`, 부제 `놀이터`.
2. 대기 화면: 내 그룹·멤버 표시, "선생님이 다음 게임을 고르고 있어요". 관리자가 게임을 고르면 "다음 게임: 🧩 퍼즐"처럼 보여 준다.
3. 게임이 시작되면 휴대폰 화면이 그 게임 화면으로 바뀐다. 끝나면(관리자가 다음 게임 준비) 대기 화면으로 돌아온다.
4. 비밀번호 재입장, 새로고침 자동 재입장은 게임과 상관없이 동작한다. 방이 사라졌으면 입장 코드 화면으로 돌아가며 안내한다.

### 주소
- 새 주소: 플레이어 `/play/`, 관리자 `/play/admin.html`. 허브는 CODE:Block 카드 하나(플레이어 입장 / 관리자).
- 예전 주소 `/puzzle/`, `/puzzle/admin.html`, `/verse/`, `/verse/admin.html`은 같은 쿼리를 붙여 새 주소로 이동한다(301이 아닌 302).

## 4. 구조

```
server.js                      Express + Socket.IO. /play 네임스페이스 하나, QR API(game 파라미터 없이 /play/?code=)
games/session/server.js        공통 방 관리: 관리자 인증·방 생성/복구/닫기, 플레이어 입장·재입장·그룹·접속 표시,
                               view별 전송, 게임 선택·시작·다음 게임 준비, 내보내기
games/puzzle/game.js           퍼즐 모듈 (지금 games/puzzle/server.js의 게임 규칙 부분)
games/verse/game.js            말씀 블록 모듈 (지금 games/verse/server.js의 게임 규칙 부분, logic.js 사용)
games/verse/logic.js           (그대로)
public/play/index.html         플레이어: 입장·그룹·대기 + 게임 화면 2개를 담는 한 페이지
public/play/player.js          플레이어 공통(입장·그룹·대기·재입장·화면 전환)
public/play/puzzle-player.js   퍼즐 게임 화면 (지금 public/puzzle/player.js의 게임 부분)
public/play/verse-player.js    말씀 블록 게임 화면 (지금 public/verse/player.js의 게임 부분)
public/play/admin.html         관리자: 공통 대기실 + 게임별 설정 패널 + 게임별 진행 화면
public/play/admin.js           관리자 공통
public/play/puzzle-admin.js    퍼즐 설정·진행 화면
public/play/verse-admin.js     말씀 블록 설정·진행 화면
public/play/*.css              지금 퍼즐/말씀 CSS를 모아서 사용 (theme.css, core.js, presets.js 재사용)
public/puzzle/, public/verse/  예전 주소 → /play/ 이동용 index.html·admin.html만 남김
```

### 게임 모듈 인터페이스
공통 서버는 게임 규칙을 모르고, 각 모듈이 아래를 제공한다.
- `id`, `title`
- `createState()` → 방에 붙는 게임별 보관 데이터(퍼즐: 사진 목록·설정, 말씀: 구절 목록·라운드 설정)
- `start(room, members)` → `{ok, error?}`: 그룹별 게임 데이터를 만든다(그룹 멤버 목록을 받음)
- `groupView(room, gi, view)`: 그 그룹의 게임 데이터(view가 관리자 또는 그 그룹일 때만 조각/블록 포함)
- `roundView(room, view)`: 게임 전체 공개 정보(퍼즐 설정·힌트, 말씀 칸 수·힌트 등. 정답 본문은 관리자에게만)
- `playerStats(room, player)` → `{assigned, left, placed}`
- `onKick(room, pid, gi)`: 내보낸 사람의 조각/블록을 그룹 안에서 넘김. 그룹이 비면 그룹을 빼고 끝 판정
- `onReset(room)`: 다음 게임 준비 때 게임 데이터 정리
- `adminEvents`, `playerEvents`: 게임 전용 이벤트 처리기 (`{ ev: (ctx, data, cb) => … }`)
- 공통 서버가 모듈에 주는 도구(ctx): `broadcast(room)`, `toGroup(room, gi, ev, data)`, `toAdmins(room, ev, data)`, `finishGroup(room, gi, by)`

### 이벤트 이름
- 공통: `admin:login|create|resume|close|settings{groups}|rename|move|kick|game{id}|start|reset`, `p:check|join|group|leave`, 서버→ `state`, `presence`, `kicked`, `closed`
- 퍼즐: 관리자 `puzzle:settings{rows,cols,shape,opacity}|image|useImage|deleteImage|hint{on}`, 플레이어 `puzzle:move|rotate`, 서버→ `puzzle:image|library|piece|placed`
- 말씀 블록: 관리자 `verse:add|delete|round{verseId,mode}|hint{ref,words}`, 플레이어 `verse:place|unplace|submit`, 서버→ `verse:list|block|locked|submitted|done`
- 게임 전용 이벤트는 그 게임이 진행 중(또는 대기실 설정)일 때만 받는다.

### 상태(state)
`{code, status:'lobby'|'playing'|'done', game:'puzzle'|'verse', settings:{groups}, players:[{pid,name,color,group,online,assigned,left,placed}], groups:[{index,name,active,finishedAt,rank, …게임별 그룹 데이터}], round:{…게임별 공개 정보}, startedAt, serverNow}`
- 대기실에서는 게임별 그룹 데이터가 비어 있다. 정답 유출 방지·그룹별 데이터 분리·변경분만 전송은 지금과 같다.

### 오류 처리
- 잘못된 payload(null 등)는 공통 래퍼에서 `{}`로 바꾸고, 처리 오류는 기록만 하고 서버는 유지한다. 서버 전체 `uncaughtException` 가드는 유지.
- 게임 진행 중에는 게임 변경·그룹 설정 변경을 막는다. 시작 후 새 플레이어 입장은 지금처럼 막고(재입장은 허용), 다음 게임 준비 후에는 새 플레이어가 들어올 수 있다.

## 5. 테스트 / 검증
- 기존 테스트를 새 네임스페이스·이벤트 이름으로 옮긴다: `test/sim.js`(퍼즐 49) → `test/puzzle-sim.js`, `test/verse-sim.js`(39), `test/verse-logic.js`(8).
- 새 `test/session-sim.js`: 한 방에서 퍼즐 → 다음 게임 준비 → 말씀 블록 → 다시 퍼즐을 **재입장 없이** 진행, 그룹·이름 유지, 게임별 이벤트가 다른 게임 중에는 거부됨, 재입장 시 진행 중인 게임 화면 복구, 게임 선택이 진행 중에는 거부됨.
- 부하: `test/load.js`(퍼즐)·`test/verse-load.js`를 새 구조로 옮겨 50명·0.1코어에서 측정.
- 브라우저: 관리자 1명 + 휴대폰 2명이 퍼즐 한 판 → 다음 게임 준비 → 말씀 블록 A 한 판을 **휴대폰 새로고침이나 재입장 없이** 끝까지 진행. 예전 주소 이동 확인. 방 사라짐 안내 확인.

## 6. 이번 범위에서 제외
- 서버 재시작 후 방 복구(무료 플랜은 영구 저장소가 없음).
- 라운드 누적 점수판, 세 번째 게임.
