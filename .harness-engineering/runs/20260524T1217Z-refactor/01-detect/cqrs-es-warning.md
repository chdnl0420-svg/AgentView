# CQRS + Event Sourcing 강제 적용 경고

본 skill 은 모든 Aggregate 에 CQRS + Event Sourcing 풀세트를 강제하나, **본 회차는 신규 도메인 구축이 아니라 기존 모놀리식 파일의 객체·역할 단위 분리 리팩토링**이다.

산업 권고 (Microsoft, Vernon) 와 본 skill 사이의 충돌 외에도, 본 회차는 도메인 자체가 "Electron 데스크탑 앱의 IPC + React UI" 라 CQRS/ES 매핑 의의가 약하다. step 2 에서는 다음과 같이 **adapt** 한다:

- **Bounded Context** = main process / renderer process 경계 (이미 Electron 이 강제하는 process boundary).
- **Aggregate** = 응집 모듈 단위 (예: "windowChrome 핸들러 묶음", "pending session 라이프사이클", "rename store").
- **Domain Event / Command** = IPC 메시지 명세 (이미 `@shared/types` 에 정의됨).
- **Repository** = file system / localStorage / SessionDaemon — 이미 존재하는 어댑터들 그대로 둠.
- **Event Sourcing replay / snapshot / versioning** = 본 회차 scope 외. ADR 로만 명시.

프로덕션 적용 시 별도 회차에서 핵심 Aggregate 만 선택해 CQRS/ES 도입 검토.
