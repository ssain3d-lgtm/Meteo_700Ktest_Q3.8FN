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

| 페이즈 | 평균 루마 | 드리프트 | 플리커 | 검정 사각형 | NaN/Inf | HDR 최대 | 콘솔 오류 | D1 클리어런스 |
|---|---|---|---|---|---|---|---|---|
| IDLE | 17.9 | 0.4% | 0 | 0 | 0 | 1.0 | 0 | – |
| SUMMON | 29.1 | 0.4% | 0 | 0 | 0 | 2.2 | 0 | – |
| CHARGE | 114.1 | 0.1% | 0 | 0 | 0 | 9.2 | 0 | – |
| SKY_WARNING | 51.9 | 0.8% | 0 | 0 | 0 | 1.7 | 0 | – |
| DESCENT | 45.1 | 0.1% | 0 | 0 | 0 | 3.0 | 0 | – |
| IMPACT | 205.3 | 0.3% | 0 | 0 | 0 | 50.1 | 0 | 0.386 |
| AFTERMATH | 40.9 | 9.8% | 0 | 0 | 0 | 2.9 | 0 | 0.291 |
| DISSIPATE | 25.8 | 8.1% | 0 | 0 | 0 | 1.8 | 0 | 0.336 |

C1 `samples=4 / HalfFloat`, C2 `RenderPass→UnrealBloom→HeatDistortion→OutputPass`,
C4 bloom 플리커 0, C5 anisotropy 16/16, A1 반복 텍스처 5종 전부 심 PASS.

카메라 디렉터(DESCENT 22샘플): 메테오가 낙하 내내 프레임 안에 유지(아웃 오브 프레임 0),
NDC y +0.33 → −0.38로 화면을 가로지르며 이동, 각 크기 1.3° → 11.7°, FOV 58 → 62.

충돌 클리핑 프로파일(충돌 후 경과시간): 0.05s 순백 13% → 0.2s 15% → 0.9s 11% →
1.3s 0% → 1.8s 0%. 화면 전체가 타는 구간 없음.

여운 필드 화면 점유(AFTERMATH 3s, 픽셀 분류 `r>70 && r>g*1.5 && g>=b`): 따뜻한 발광 영역
전체 프레임의 16.8%, 하반부만 12.0%. 용암 웅덩이 반지름 17.2가 NDC (0, −0.28)에 보이고,
균열 데칼 opacity 0.70, 스코치 0.81, 잔존 자갈 130개, ember 364 / 연기 277.

오디오(AnalyserNode로 리미터 출력을 실측, 48 kHz):

| 구간 | 피크 | 평균 RMS | 클리핑 프레임 |
|---|---|---|---|
| SKY_WARNING | 0.37 | 0.112 | 0 |
| DESCENT | 0.66 | 0.145 | 0 |
| IMPACT (2.5s 창) | 0.87 | 0.138 | 0 |
| AFTERMATH (6s 창) | 0.61 | 0.148 | 0 |
| IDLE | 0.20 | 0.006 | 0 |

수명주기 측정(결정적 스텝): 크레이터 반지름 21 · 깊이 8.2 · rim +3.84, 용암 웅덩이가
바닥을 따라가며 간격 0.25로 유지, DISSIPATE 1.6s부터 지면 되메워져 5.0s에 최저점 0(원형 바닥).

기능: Full Demo 완주 후 IDLE 복귀, Reset 시 파티클 0·크레이터 0·용암 비활성,
Sound OFF 시 master gain 0 / ON 시 0.8, 창 크기 변경 시 렌더러·composer·파티클
프로젝션 스케일이 모두 재계산됨.

수명주기 측정(결정적 스텝): IMPACT에서 지면 최저점 −9.09(크레이터 깊이 8.2 + 요철),
AFTERMATH 3s까지 잔류 필드 유지, DISSIPATE 1.6s부터 지면이 되메워져 5.0s에 최저점 0(원형 바닥),
스코치/균열 데칼과 용암 모두 소멸 → IDLE은 깨끗한 바닥으로 복귀.

## 두 번째 라운드: 사용자 목격 결함과 측정

"낙하는 좋지만 충돌 후 크레이터가 없고 이상한 주황색 줄만 보인다"는 보고로 드러난 결함:

| 결함 | 측정값 | 원인 | 조치 |
|---|---|---|---|
| 용암이 크레이터 바닥에 없음 | 웅덩이 Y `0.25` vs 바닥 `−6.52` → **6.77 차이** | `activate()`가 `crater.progress === 0`인 순간에 한 번 conform. 이후 지형이 파여도 따라가지 않음 | `Lava.update`가 `crater.progress` 변화를 보고 매번 재-conform → 간격 0.25 |
| "주황색 줄" | 반지름 15.6짜리 평면 디스크가 y=0.25에 떠 있고 카메라가 y=4.4에서 거의 정면으로 관측 | 위 항목의 결과: 평면이 edge-on으로 선처럼 보임 | 용암이 bowl을 추종 + 카메라 상향 |
| 크레이터가 안 보임 | 카메라 수평거리 19.6 vs 크레이터 반지름 19, 카메라 높이 4.4 vs rim 2.1 | 카메라가 rim 한복판에서 접선 방향으로 봄 | AFTERMATH 포즈 `[16.5, 12.0, 23.0]` → 시선 `[0, −2.8, 0]`, rim NDC x −1.03..1.04 |
| 자갈이 안 보임 | 파편 140개 크기 0.28–1.0, 조명 감쇠 후 무광 | 폭발 조명(1.9s 소멸)에만 의존 | 크레이터에 잔존 rubble InstancedMesh 130개(0.59–1.61), 용암 조명에 반응하는 emissive |
| 임팩트 소리 약함 | 리미터 전 피크 1.008(DESCENT)·0.996(IMPACT), 20–80 Hz 대역 포화 | 서브베이스(24–38 Hz)가 헤드룸을 전부 소비 — 노트북 스피커에서는 무음인데 리미터만 작동 | 30 Hz highpass tilt, 서브 게인 0.22→0.10 등 재배분, 300→58 Hz 가청 mid punch, tanh waveshaper, 리미터 threshold −10→−3 / ratio 14→4 |
| 용암 웅웅거림·파쇄음 없음 | crackle peak 0.10, bubbling 0.10, 주기 220–1320 ms | 가청 대역 에너지가 부족 | gurgle 110–320 Hz(주파수 유동) + fumarole hiss 추가, crackle peak 0.26, 주기 130–830 ms, rock-tumble/blorp 이벤트 분기 |

이 라운드에서 게이트가 새 회귀도 잡았다: 요철을 키우자 rim 경계의 **기울기 불연속** 때문에
데칼 클리어런스가 0.3 → 0.066으로 붕괴(D1 FAIL). `heightAt`을 smoothstep blended C1 프로파일로
다시 쓰고 데칼 ring을 28→60, clearance 0.3→0.42로 올려 D1 0.291–0.386 회복.

## 세 번째 라운드: 화염 기둥과 임팩트 질감

| 문제(사용자 보고) | 측정 | 원인 | 조치 |
|---|---|---|---|
| "세로 주황 기둥이 뭐냐, 연기도 아니다" | 기둥이 프레임 15.5%를 덮고 픽셀 기여 평균 14.9 / 최대 33, 단단한 픽셀 0 | 원기둥 실루엣에 균일 alpha → 발광 막대이자 옅은 베일. 난류가 반경 방향으로만 작용해 외곽선이 통째로 유지 | plume 프로파일(넓은 밑·잘린 목·부풀어오르는 머리), 높이 따라 커지는 난류 변위, 좁은 shape 창(0.36–0.60)으로 불꽃 혀+실제 틈, 상단은 재로 감쇠, 높이 38→26·반지름 6→4.8 |
| | 재측정: 프레임 **0.9% → 4.0%**, 세로 50→222행으로 성장, **sd/mean 0.84–1.06** | sd/mean ≪ 1 이면 균일 막대. 1에 가까우면 내부 구조가 강한 불꽃 | 확인됨 |
| "임팩트가 튱 하고 끝난다" | 스펙트럼이 아니라 파형 문제: 110→24 Hz, 60→18 Hz, 300→58 Hz **오실레이터 스윕**이 임팩트의 주 구성요소 | 스윕 사인/삼각파가 만화 같은 붐을 만들고, 그 뒤 재질 소리가 없음 | 전부 노이즈 트랜지언트로 교체: broad slam(2600→700 Hz bandpass, 2 ms attack), 저역 바디 "쿵"(brown noise lowpass 420→130), slab fracture snap 3발, tanh 왜곡 fireball roar, ground roll. 서브는 70→28 Hz 0.24로 무게만 추가 |
| "자갈이 바닥에 부딪히는 소리가 나야 한다" | 임팩트 후 지속 이벤트 0건(14개 일회성 burst만, 모두 3.2 s 이내) | 스케줄러 없음 | `_startDebrisRain()` — 5.5 s 동안 110–300 ms 간격으로 7→2회/버스트, 큰 바위(120–340 Hz 저역)와 작은 자갈(300–2500 Hz) 분기, 강도는 시간에 따라 감쇠 |
| | 실측: 6 s 창에서 **트랜지언트 온셋 38건**, ZCR 평균 2324 Hz(최소 820) | 스윕 사인은 ZCR이 단조 하락해야 한다. 820–3469 Hz로 요동 = 광대역 재질 트랜지언트 | 확인됨 |
| 레벨 | bus 0.85 → 피크 1.04 + 클리핑 1 프레임 | 헤드룸 초과 | bus 0.72 → **피크 0.885, 클리핑 0** |

측정 방법론 오류도 하나 잡았다: 격리 프로브가 `setRenderTarget(null)` **뒤에** `readPixels(HALF_FLOAT)`를
호출해 ANGLE이 "Invalid format and type combination"으로 거부 → 기둥 기여가 0으로 잘못 측정됐다.
RT가 바인딩된 동안 읽도록 고쳐 실제 값을 얻었다.

임팩트 시 다른 레이어를 0.15 s 안에 덕팅(bed 0.14 / warning 0.08 / descent 0.12)해
임팩트가 앰비언스에 묻히지 않는다.

최종 게이트: **PASS 99 / FAIL 0 / WARN 0 / NOT TESTED 13**, 콘솔 오류 0, NaN/Inf 0,
bloom 검은 패치 0, D1 0.291–0.386.

## 남은 개선 포인트

- 마법진 룬은 캔버스 드로잉 기반이라 근접 확대 시 선이 부드럽다. 실제 게임에서는
  SDF 룬Atlas가 적합하다.
- 열 왜곡은 화면 공간 변위(가짜 refractive)다. 정밀한 열기 왜곡에는 렌더 타깃 2장 +
  노멀 맵 샘플링이 필요하다.
- 파티클 CPU 업데이트는 용량 기준 O(n). 2만 개 이상으로 올리면 GPU 시뮬레이션으로 옮겨야 한다.
- 오디오는 절차적 합성만 사용. 실제 프로젝트에서는 layer별 Send(리버브)와
  충돌 위치 기반 PannerNode(3D 팬닝)가 추가되면 몰입도가 올라간다.
- `npm run gate`의 자동 브라우저 구동은 `npm i -D playwright` 설치 후 동작한다.

