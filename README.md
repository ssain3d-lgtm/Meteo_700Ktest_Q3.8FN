# METEOR STRIKE — Three.js 궁극기 스킬 VFX 데모

바닥 마법진 소환 → 충전 → 하늘 경고 → 메테오 낙하 → 충돌 → 크레이터/용암 잔류 필드 → 소멸까지
8개 상태로 진행되는 시네마틱 궁극기 연출 데모. 모든 텍스처와 사운드는 절차적으로 생성된다
(외부 에셋 없음).

## 실행 방법

```bash
npm install
npm run serve
# 브라우저에서 http://127.0.0.1:8792/index.html
```

`Full Demo` 버튼을 누르면 전체 시퀀스가 자동 진행됩니다. 각 단계 버튼으로 개별 페이즈만
볼 수도 있고, `Reset`으로 초기화합니다. 사운드는 첫 클릭(유저 제스처) 이후에 활성화됩니다.

## 파일 구조

```
index.html
package.json
src/
  main.js                  렌더러/씬/루프 조립, window.__meteorApp 노출
  params.js                슬라이더로 제어하는 런타임 파라미터
  stateMachine.js          IDLE..DISSIPATE 상태 머신
  cameraDirector.js        페이즈별 카메라 포즈 + 낙하 추적 + shake 레이어
  director.js              상태 머신과 모든 이펙트/오디오를 연결하는 안무
  ui.js                    버튼/슬라이더/페이즈 표시
  audio/
    meteorAudio.js         절차적 Web Audio 레이어 6종 + impact 일회성 이벤트
  effects/
    glslCommon.js          공유 GLSL fbm/hash chunks
    proceduralTextures.js  (src/assets) 절차적 캔버스 텍스처 + 심 방지
    magicCircle.js         마법진 5레이어 + 코어 + 룬 아크
    meteor.js              암석 크러스트 + 용암 균열 + 화염 오라 + 코어 + 방출
    fireTrail.js           낙하 궤적 리본 + 모션 스트릭
    explosion.js           화구, 화염 기둥, 접지 플래시, 3D 파편(instanced)
    shockwave.js           3중 충격파 링 + 열파 스커트 + 먼지 시트
    crater.js              지면 변형 크레이터 + 지형 추종 데칼(스코치/용암 균열)
    lava.js                용암 웅덩이 + 가장자리 발광 + ember 루프 + 연기
    particles.js           풀링된 GPU 파티클 시스템 5종
    postfx.js              RenderPass → UnrealBloom → HeatDistortion → OutputPass
    cameraShake.js         base + impulse 카메라 흔들림
    skyWarning.js          하늘 균열 + 접근 광원
    environment.js         스카이 돔, 조명, 안개, 바위, 지면 안개
  assets/
    proceduralTextures.js
    LICENSES.md
  quality/
    renderQualityGate.js   브라우저 내 렌더 품질 측정 (A1..F1)
tools/
  serve.mjs                무의존 정적 서버 + 게이트 리포트 수신
  quality/gate.mjs         게이트 러너 (정적 검사 + 페이즈 표)
  quality/summarize.mjs    리포트 집계
  quality/wait-report.mjs  리포트 대기
```

## 상태 머신

| 상태 | 목적 | 주요 연출 | 오디오 |
|---|---|---|---|
| IDLE | 대기 | 어두운 안개만 | 무음 |
| SUMMON | 전조 | 마법진 스케일업/페이드인, 5레이어 역회전 | bed rumble + hum |
| CHARGE | 고조 | 밝기/회전 상승, 입자 흡인, 열기 왜곡 | hum/shimmer 상승 |
| SKY_WARNING | 압박 | 하늘 균열, 돔 적색 전환, 먼 접근광 | warning 저역 |
| DESCENT | 낙하 | 메테오 + 화염 꼬리 + 연기 + 파편, 카메라 추적 | whoosh/roar |
| IMPACT | 충돌 | 플래시/화구/기둥/충격파/파편/먼지, 강한 shake | crack+thud+crash |
| AFTERMATH | 여운 | 크레이터, 용암 균열, ember/smoke 루프, 열 왜곡 | magma ambience |
| DISSIPATE | 소멸 | 전체 감쇠 | 페이드아웃 |

## 성능 메모

- 파티클은 용량 고정 버퍼 + 데드 파티클 컴팩션(drawRange 축소)으로 재사용한다.
- 낙하 꼬리 리본은 고정 크기 버퍼를 매 프레임 갱신(할당 없음).
- 파편은 `InstancedMesh` 140개 풀.
- 텍스처는 로드 시 1회 생성, anisotropy는 하드웨어 최대치로 통일.
- `dispose()`는 각 모듈이 소유한 지오메트리/머티리얼을 정리한다.

## 검증

```bash
npm run gate:static   # 소스 정적 검사 (GPU 불필요)
npm run gate          # 8개 페이즈 런타임 측정
```

`npm run gate`는 `playwright` node 모듈이 있으면 브라우저를 자동 구동하고, 없으면
직접 열어야 할 URL 8개를 출력한 뒤 `quality/report-<PHASE>.json`을 기다린다
(이 저장소에서는 MCP 브라우저로 구동해 검증했다).

측정 항목: A1 반복 텍스처 심 / B1 HDR 버퍼 NaN·Inf / C1 MSAA 샘플 / C2 composer 체인 /
C3 그레인 델타 / C4 bloom 플리커·검은 패치 / C5 anisotropy / D1 데칼 클리어런스 /
E1 프레임 회귀 + 검정 사각형 / F1 콘솔 오류.
측정하지 못한 항목은 PASS가 아니라 NOT TESTED로 보고한다.

### 2026-10-11 측정 결과 (1280x720, Chromium)

정적 검사 8 PASS. 런타임 8개 페이즈: **PASS 99 / WARN 0 / FAIL 0 / NOT TESTED 13**
(NOT TESTED = 크레이터가 없는 5개 페이즈의 D1, 그레인 패스가 없는 C3).

| 페이즈 | 평균 루마 | 플리커 | 검정 사각형 | NaN/Inf | HDR 최대 | 콘솔 오류 | 데칼 클리어런스 |
|---|---|---|---|---|---|---|---|
| IDLE | 17.9 | 0 | 0 | 0 | 1.0 | 0 | – |
| SUMMON | 28.4 | 0 | 0 | 0 | 2.1 | 0 | – |
| CHARGE | 110.2 | 0 | 0 | 0 | 10.3 | 0 | – |
| SKY_WARNING | 51.6 | 0 | 0 | 0 | 1.7 | 0 | – |
| DESCENT | 44.8 | 0 | 0 | 0 | 3.3 | 0 | – |
| IMPACT | 204.8 | 0 | 0 | 0 | 45.7 | 0 | 0.291 |
| AFTERMATH | 75.7 | 0 | 0 | 0 | 3.3 | 0 | 0.266 |
| DISSIPATE | 31.0 | 0 | 0 | 0 | 1.9 | 0 | 0.266 → 0.278 |

재실행(기준선 대비 드리프트): 페이즈별 평균 루마 변화 0.3% ~ 4.5%, 전부 WARN 기준(12%) 이내.
모든 텍스처가 로드마다 `Math.random()`으로 생성되므로 이 정도 편차는 정상이다.

카메라 디렉터(DESCENT 22샘플): 메테오가 낙하 내내 프레임 안에 유지(아웃 오브 프레임 0),
NDC y +0.33 → −0.38로 화면을 가로지르며 이동, 각 크기 1.3° → 11.7°, FOV 58 → 62.

충돌 클리핑 프로파일(충돌 후 경과시간): 0.05s 순백 13% → 0.2s 15% → 0.9s 11% →
1.3s 0% → 1.8s 0%. 화면 전체가 타는 구간 없음.

기능: Full Demo 완주 후 IDLE 복귀, Reset 시 파티클 0·크레이터 0·용암 비활성,
Sound OFF 시 master gain 0 / ON 시 0.8, 창 크기 변경 시 렌더러·composer·파티클
프로젝션 스케일이 모두 재계산됨.

수명주기 측정(결정적 스텝): IMPACT에서 지면 최저점 −6.75(크레이터 깊이), AFTERMATH 3s까지
잔류 필드 유지, DISSIPATE 1.6s부터 지면이 되메워져 5.0s에 최저점 0(원형 바닥), 스코치/균열
데칼과 용암 모두 소멸 → IDLE은 깨끗한 바닥으로 복귀.

## 남은 개선 포인트

- `Crater` 지형은 분석적 함수 단일 버전(주파수 1). 크레이터 가장자리에 자갈 메시를
  추가하면 파편과 함께 파괴 느낌이 더 강해진다.
- 마법진 룬은 캔버스 드로잉 기반이라 근접 확대 시 선이 부드럽다. 실제 게임에서는
  SDF 룬Atlas가 적합하다.
- 열 왜곡은 화면 공간 변위(가짜 refractive)다. 정밀한 열기 왜곡에는 렌더 타깃 2장 +
  노멀 맵 샘플링이 필요하다.
- 파티클 CPU 업데이트는 용량 기준 O(n). 2만 개 이상으로 올리면 GPU 시뮬레이션으로 옮겨야 한다.
- 오디오는 절차적 합성만 사용. 실제 프로젝트에서는 layer별 Send(리버브)와
  충돌 위치 기반 PannerNode(3D 팬닝)가 추가되면 몰입도가 올라간다.
- `npm run gate`의 자동 브라우저 구동은 `npm i -D playwright` 설치 후 동작한다.

