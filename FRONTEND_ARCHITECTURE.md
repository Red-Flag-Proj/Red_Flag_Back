# FDS Frontend Architecture

이 문서는 현재 Node.js/Express/PostgreSQL 백엔드(`fds-backend-node`)를 기준으로 금융 이상거래 탐지 대시보드 프론트엔드를 설계하기 위한 아키텍처 가이드다. 백엔드는 `http://localhost:4000/api`를 기본 API URL로 사용하며, 인증은 JWT Bearer 토큰 기반이다.

## 1. 목표와 범위

프론트엔드는 두 사용자군을 지원한다.

- 일반 사용자: 로그인, 본인 거래 등록, 거래 목록/상세 조회, ARS 수동 발신 요청
- 관리자/분석가: 탐지 현황 대시보드, 이상거래 큐, 거래 상세, 관리자 조치, 정책 룰 토글, 감사 로그 확인, CSV/PDF 리포트 다운로드

백엔드가 이미 탐지 점수 계산, 정책 적용, 자동 대응 액션, ARS 콜 검증, 리포트 생성을 담당하므로 프론트는 도메인 로직을 재구현하지 않는다. 프론트의 책임은 API 응답을 신뢰 가능한 UI 상태로 정규화하고, 권한에 맞는 워크플로를 빠르게 수행하도록 구성하는 것이다.

## 2. 권장 기술 스택

- Framework: React + TypeScript + Vite
- Routing: React Router
- Server State: TanStack Query
- Client State: Zustand 또는 React Context
- Forms: React Hook Form + Zod
- HTTP Client: Axios 또는 `fetch` 래퍼
- UI: 기존 프로젝트가 없다면 shadcn/ui 계열 컴포넌트 + lucide-react 아이콘
- Charts: Recharts
- Tests: Vitest + React Testing Library, Playwright

금융 운영 콘솔 성격이 강하므로 마케팅형 랜딩 화면보다 밀도 있는 업무 화면을 기본 첫 화면으로 둔다.

## 3. 런타임 설정

프론트 환경 변수 예시:

```env
VITE_API_BASE_URL=http://localhost:4000/api
VITE_HEALTH_URL=http://localhost:4000/health
```

백엔드 CORS 기본값은 `http://localhost:3000`이다. Vite 기본 포트인 `5173`을 사용한다면 백엔드 `.env`의 `CORS_ORIGIN`에 `http://localhost:5173`을 포함해야 한다.

## 4. 애플리케이션 구조

권장 디렉터리:

```text
src/
  app/
    router.tsx
    providers.tsx
  api/
    client.ts
    auth.api.ts
    transactions.api.ts
    admin.api.ts
    reports.api.ts
  features/
    auth/
    user-transactions/
    admin-dashboard/
    transaction-detail/
    policy-rules/
    reports/
  components/
    layout/
    data-table/
    status-badge/
    risk-badge/
    confirm-dialog/
  hooks/
    useAuth.ts
    usePollingInterval.ts
  lib/
    format.ts
    constants.ts
    errors.ts
  types/
    api.ts
    domain.ts
```

라우트, API, 기능 모듈을 분리한다. 화면 컴포넌트는 직접 `fetch`를 호출하지 않고 `api/*`와 TanStack Query hooks를 통해서만 서버 상태에 접근한다.

## 5. 인증과 권한

백엔드는 `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`를 제공한다. 로그인/회원가입 응답은 `{ user, token }` 형태다. `GET /api/auth/me`는 Bearer 토큰을 검증하고 `{ user }`를 반환한다.

프론트 처리 원칙:

- 토큰 저장: 초기 구현은 `localStorage` 또는 `sessionStorage`를 사용할 수 있다. 운영 보안 수준이 올라가면 httpOnly 쿠키 방식으로 백엔드 변경을 검토한다.
- API 요청: `Authorization: Bearer <token>` 헤더를 공통 인터셉터에서 부여한다.
- 401: 토큰 제거 후 로그인 화면으로 이동한다.
- 403: 접근 거부 페이지 또는 관리자 권한 필요 메시지를 표시한다.
- 역할: `user.role`이 `ADMIN`이면 관리자 라우트를 노출하고, `USER`이면 사용자 거래 화면만 노출한다.

권장 라우트:

```text
/login
/register
/app/transactions
/app/transactions/new
/app/transactions/:id
/admin
/admin/transactions
/admin/transactions/:id
/admin/policy-rules
/admin/reports
```

## 6. API 클라이언트 설계

공통 응답 에러 형태:

- Zod 검증 실패: HTTP 400, `{ message, errors }`
- 일반 오류: `{ message }`
- 인증 오류: HTTP 401
- 권한 오류: HTTP 403
- 충돌 상태: HTTP 409
- Twilio 비활성 등 서비스 불가: HTTP 503
- FraudGuard 프로세스 실패: HTTP 502
- FraudGuard 탐지 타임아웃: HTTP 504

`api/client.ts`는 다음을 담당한다.

- `VITE_API_BASE_URL` 기반 URL 조립
- Bearer 토큰 삽입
- JSON 요청/응답 처리
- 파일 다운로드 응답 처리
- 백엔드 오류를 `ApiError`로 정규화

예시 타입:

```ts
type ApiError = {
  status: number;
  message: string;
  errors?: unknown;
};
```

## 7. 도메인 모델

백엔드 DB와 서비스 응답 기준 핵심 타입:

```ts
type UserRole = 'USER' | 'ADMIN';

type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'PAYMENT';

type RiskLevel = 'NORMAL' | 'SUSPICIOUS' | 'DANGER';

type TransactionStatus =
  | 'APPROVED'
  | 'PENDING_REVIEW'
  | 'REQUIRES_AUTH'
  | 'CALL_REQUIRED'
  | 'CALL_IN_PROGRESS'
  | 'CALL_CONFIRMED'
  | 'BLOCKED'
  | 'CARD_SUSPENDED';

type AdminAction =
  | 'APPROVE'
  | 'HOLD'
  | 'BLOCK'
  | 'REQUEST_AUTH'
  | 'CALL_APPROVE'
  | 'CALL_HOLD';

type ResponseActionType =
  | 'APPROVE_TRANSACTION'
  | 'HOLD_TRANSACTION'
  | 'BLOCK_TRANSACTION'
  | 'REQUEST_STEP_UP_AUTH'
  | 'CALL_CUSTOMER'
  | 'SUSPEND_CARD'
  | 'FREEZE_TRANSFER'
  | 'NOTIFY_CUSTOMER'
  | 'QUEUE_MANUAL_REVIEW';
```

백엔드는 일부 필드를 snake_case로 반환한다. 프론트는 둘 중 하나를 선택해야 한다.

- 빠른 구현: API 응답 타입은 snake_case 그대로 유지
- 장기 운영: API adapter에서 camelCase로 변환하고 UI는 camelCase만 사용

운영 콘솔에서는 일관성이 중요하므로 장기적으로 adapter 변환을 권장한다.

## 8. API 목록과 프론트 사용처

### Auth

| Method | Endpoint | 사용 화면 | 비고 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | 회원가입 | `email`, `username`, `password`, optional `role` |
| POST | `/api/auth/login` | 로그인 | `emailOrUsername`, `password`, optional `deviceId` |
| GET | `/api/auth/me` | 앱 부트스트랩 | Bearer 토큰 필요 |

### User Transactions

| Method | Endpoint | 사용 화면 | 비고 |
| --- | --- | --- | --- |
| GET | `/api/transactions` | 사용자 거래 목록 | `{ transactions }` |
| POST | `/api/transactions` | 거래 생성 | `{ transaction }`; 생성 즉시 탐지 결과 포함 |
| GET | `/api/transactions/:id` | 거래 상세 | action logs, response actions, call verifications 포함 |
| POST | `/api/transactions/:id/ars-call` | 거래 상세 | ARS 수동 발신. `skipped` 여부 표시 |

사용자 거래 생성 폼 필드:

- 필수: `type`, `amount`, `occurredAt`
- 선택: `countryCode`, `city`, `latitude`, `longitude`, `ipAddress`, `deviceId`, `paymentMethod`, `recipientAccount`

### Admin

| Method | Endpoint | 사용 화면 | 비고 |
| --- | --- | --- | --- |
| POST | `/api/admin/transactions` | 관리자 거래 시뮬레이션/생성 | `customerRef` 필수 |
| GET | `/api/admin/stats` | 관리자 대시보드 | optional `source` |
| GET | `/api/admin/suspicious-transactions` | 이상거래 큐 | optional `source`, `risk`; `risk=all` 지원 |
| GET | `/api/admin/transactions/:id` | 관리자 거래 상세 | 전체 거래 상세 |
| POST | `/api/admin/transactions/:id/actions` | 관리자 조치 | `action`, optional `memo` |
| GET | `/api/admin/policy-rules` | 정책 룰 관리 | `{ rules }` |
| POST | `/api/admin/policy-rules/:id/toggle` | 정책 룰 관리 | optional `reason` |
| GET | `/api/admin/policy-rule-logs` | 정책 감사 로그 | `{ logs }` |

README에 언급된 `POST /api/admin/fake-transactions`는 현재 라우트에 연결되어 있지 않다. 프론트에서는 사용하지 않는다.

### Reports

| Method | Endpoint | 사용 화면 | 비고 |
| --- | --- | --- | --- |
| GET | `/api/reports/fraud.csv` | 리포트 다운로드 | 관리자 전용, `text/csv` |
| GET | `/api/reports/fraud.pdf` | 리포트 다운로드 | 관리자 전용, `application/pdf` |

파일 다운로드는 JSON 클라이언트와 별도 함수로 구현한다.

### ARS Webhook

`POST /api/ars/call-verifications/:id/response`는 외부 ARS/Twilio 연동용이다. 일반 웹 프론트에서 직접 호출하지 않는다. 관리자 UI는 거래 상세의 `call_verifications` 상태를 조회하고 필요 시 관리자 조치 `CALL_APPROVE`, `CALL_HOLD` 또는 수동 ARS 발신 API를 사용한다.

Twilio 콜백은 `/api/ars/twilio/:id/voice`, `/api/ars/twilio/:id/gather`, `/api/ars/twilio/:id/status`로 연결된다. 이 라우트는 `urlencoded` body와 Twilio signature 검증 미들웨어를 사용하므로 브라우저 UI 호출 대상이 아니다.

## 9. 화면 아키텍처

### 로그인/회원가입

- 로그인 성공 시 토큰과 사용자 정보를 저장한다.
- `role`에 따라 `/admin` 또는 `/app/transactions`로 이동한다.
- 로그인 실패는 백엔드 `message`를 표시하되, 인코딩이 깨진 메시지가 올 수 있으므로 기본 fallback 문구를 둔다.

### 사용자 거래 목록

- `GET /api/transactions`
- 컬럼: 발생시각, 유형, 금액, 국가/도시, 상태, 위험도, 위험점수
- 상태 배지는 `TransactionStatus` 기준으로 색상과 라벨을 고정한다.
- 위험도 배지는 `NORMAL`, `SUSPICIOUS`, `DANGER` 세 단계로 표시한다.

### 사용자 거래 생성

- React Hook Form + Zod로 백엔드 스키마와 같은 제약을 적용한다.
- `occurredAt`은 ISO datetime 문자열로 전송한다.
- 생성 성공 후 상세 화면으로 이동하고 탐지 결과를 즉시 보여준다.

### 관리자 대시보드

- `GET /api/admin/stats`
- 주요 카드: 전체 거래, 위험 거래, 평균 위험 점수, 정상/의심/위험 분포, 승인/추가인증/ARS/차단/카드정지 카운트
- 차트: 위험도 분포, 상태 분포
- 필터: `source` 값 `api-demo`, `ai-generated`, `ai-import`, 전체

### 이상거래 큐

- `GET /api/admin/suspicious-transactions`
- 기본은 `risk=suspicious`로 정상 거래 제외
- 전체 모드는 `risk=all`
- 컬럼: 고객 참조, 마스킹 고객명, 유형, 금액, 국가/도시, 위험점수, 위험도, 상태, 권장 액션, 발생시각
- 행 클릭 시 관리자 거래 상세로 이동

### 거래 상세

- `GET /api/admin/transactions/:id` 또는 `GET /api/transactions/:id`
- 섹션:
  - 거래 개요
  - 탐지 결과: `rule_score`, `personal_score`, `risk_score`, `risk_level`, `reasons`, `triggered_rules`, `score_breakdown`, `model_info`, `ars_policy`
  - 대응 액션: `response_actions`
  - ARS 콜 검증: `call_verifications`
  - 감사 로그: `action_logs`
- 관리자 화면에서는 조치 패널을 제공한다.

### 관리자 조치 패널

- `POST /api/admin/transactions/:id/actions`
- 액션:
  - `APPROVE`: 승인
  - `HOLD`: 검토 보류
  - `BLOCK`: 차단
  - `REQUEST_AUTH`: 추가 인증 요청
  - `CALL_APPROVE`: ARS 확인 승인
  - `CALL_HOLD`: ARS 보류
- `BLOCK`, `HOLD`, `CALL_HOLD` 같은 위험 조치는 메모 입력을 강하게 유도한다. 백엔드에는 memo validation 서비스가 있으므로 실패 메시지를 UI에 표시한다.

### 정책 룰 관리

- `GET /api/admin/policy-rules`
- `POST /api/admin/policy-rules/:id/toggle`
- `GET /api/admin/policy-rule-logs`
- 룰 테이블 컬럼: ID, 코드, 카테고리, 조건, 점수, 최대 카테고리 점수, 활성 여부, 배포 상태, 최종 수정자, 최종 수정일
- 토글 시 reason 입력 모달을 띄우고, 성공 후 룰 목록과 로그 쿼리를 invalidate한다.

### 리포트

- CSV/PDF 다운로드 버튼
- 다운로드 요청은 관리자 토큰을 포함해야 한다.
- 실패 시 JSON 오류가 아닐 수 있으므로 content-type을 확인한다.

## 10. 서버 상태 관리

TanStack Query key 예시:

```ts
['auth', 'me']
['transactions']
['transactions', transactionId]
['admin', 'stats', source]
['admin', 'suspicious-transactions', { source, risk }]
['admin', 'transactions', transactionId]
['admin', 'policy-rules']
['admin', 'policy-rule-logs']
```

mutation 후 invalidation:

- 거래 생성: `['transactions']`, `['admin', 'stats']`, `['admin', 'suspicious-transactions']`
- 관리자 조치: 해당 거래 상세, 이상거래 큐, 통계
- ARS 수동 발신: 해당 거래 상세
- 정책 룰 토글: 정책 룰 목록, 정책 로그

## 11. 폴링과 실시간성

현재 백엔드는 WebSocket/SSE를 제공하지 않는다. 프론트는 폴링 기반으로 설계한다.

- 관리자 대시보드: 10-15초 간격
- 이상거래 큐: 5-10초 간격
- 거래 상세에서 `CALL_REQUIRED` 또는 `CALL_IN_PROGRESS`: 3-5초 간격
- 문서가 비활성화된 탭에서는 폴링 중지 또는 간격 확대

향후 실시간 요구가 커지면 `/api/admin/suspicious-transactions`와 거래 상세 갱신을 SSE로 확장하는 것을 1순위로 검토한다.

## 12. 상태/위험도 표시 규칙

위험도:

- `NORMAL`: 낮은 위험, 승인 가능
- `SUSPICIOUS`: 추가 인증 또는 ARS 필요
- `DANGER`: 차단/보류/카드 정지 가능성

거래 상태:

- `APPROVED`: 완료
- `PENDING_REVIEW`: 분석가 검토 필요
- `REQUIRES_AUTH`: 추가 인증 필요
- `CALL_REQUIRED`: ARS 발신 필요
- `CALL_IN_PROGRESS`: ARS 진행 중
- `CALL_CONFIRMED`: 고객 확인 완료
- `BLOCKED`: 거래 차단
- `CARD_SUSPENDED`: 카드 정지

상태 전이는 프론트에서 임의로 계산하지 않는다. 액션 버튼 활성화 여부도 현재 상태와 백엔드 실패 응답을 함께 기준으로 둔다.

## 13. 개인정보와 마스킹

백엔드는 고객명, 계좌번호, IP, device ID, 전화번호 일부를 마스킹해서 반환한다. 프론트는 다음 원칙을 따른다.

- 마스킹된 값을 원본처럼 취급하고 복원 UI를 만들지 않는다.
- 거래 상세에서도 백엔드 응답 그대로 표시한다.
- export 파일은 백엔드가 생성한 결과만 다운로드한다.
- 로그, 에러 트래킹, analytics에 토큰이나 거래 상세 전문을 남기지 않는다.

## 14. 폼 검증

백엔드 Zod 스키마와 같은 제약을 프론트에서도 적용한다.

- 금액: 양수
- 거래 유형: `DEPOSIT`, `WITHDRAWAL`, `TRANSFER`, `PAYMENT`
- 발생시각: ISO datetime
- 국가 코드: 2자리
- 문자열 최대 길이: 백엔드 스키마와 동일하게 제한
- 관리자 거래 생성: `customerRef`, `type`, `amount`, `occurredAt` 필수

프론트 검증은 사용자 경험용이며, 최종 검증은 백엔드 응답을 따른다.

## 15. 테스트 전략

단위 테스트:

- API client가 401/403/409/503과 Zod error를 올바르게 정규화하는지 검증
- status/risk badge 매핑 검증
- adapter를 도입한 경우 snake_case to camelCase 변환 검증

컴포넌트 테스트:

- 로그인 성공/실패
- 관리자 권한 라우트 보호
- 이상거래 큐 필터링 UI
- 관리자 조치 mutation 성공 후 invalidate 동작
- 정책 룰 토글 확인 모달

E2E 테스트:

- 로그인 후 역할별 시작 화면 진입
- 사용자 거래 생성 후 상세 확인
- 관리자 이상거래 상세에서 조치 적용
- CSV/PDF 다운로드 요청

## 16. 구현 순서

1. 프로젝트 스캐폴딩과 공통 레이아웃 구성
2. API client, auth store, protected route 구현
3. 로그인/회원가입과 `/me` 부트스트랩 구현
4. 사용자 거래 목록/생성/상세 구현
5. 관리자 대시보드와 이상거래 큐 구현
6. 관리자 거래 상세, 조치 패널, ARS 수동 발신 UI 구현
7. 정책 룰 관리와 감사 로그 구현
8. 리포트 다운로드 구현
9. 폴링, 에러 처리, 빈 상태, 로딩 상태 정리
10. 테스트와 접근성 점검

## 17. 백엔드 연동 주의사항

- 백엔드 일부 한국어 오류 메시지가 인코딩 깨짐 상태로 보일 수 있다. 프론트는 상태 코드별 fallback 문구를 준비한다.
- `POST /api/admin/fake-transactions`는 README에 있으나 현재 라우트에 없다.
- `POST /api/admin/transactions`가 관리자 거래 생성의 실제 라우트다.
- `CALL_REQUIRED` 상태의 거래는 ARS 수동 발신 API를 통해 `CALL_IN_PROGRESS`로 전환될 수 있다.
- `TWILIO_ENABLED=false`이면 새 ARS 발신은 503으로 실패할 수 있다.
- `source` 필터는 `api-demo`, `ai-generated`, `ai-import`를 지원한다.
- 백엔드는 snake_case 필드를 많이 반환하므로 UI 타입 정책을 초기에 확정해야 한다.

## 18. 검증 체크리스트

- 백엔드 라우트와 문서의 API 목록이 일치하는가
- 모든 관리자 API에 Bearer 토큰과 `ADMIN` 역할이 필요한가
- 거래 상세 화면이 `action_logs`, `response_actions`, `call_verifications`를 모두 표시하는가
- 위험도/상태 enum이 스키마와 서비스 코드를 모두 반영하는가
- ARS 웹훅 API를 사용자 UI에서 직접 호출하지 않는가
- 리포트 다운로드가 blob/file 응답으로 처리되는가
- 폴링이 백엔드 부하를 과도하게 만들지 않는가
