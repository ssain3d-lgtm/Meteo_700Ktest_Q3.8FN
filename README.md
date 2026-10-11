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

`npm run gate:static` (GPU 불필요) 및 `npm run gate` (8개 페이즈 런타임 측정)로
A1 심 / B1 NaN·Inf / C1 MSAA / C2 체인 / C4 bloom 플리커 / C5 anisotropy /
D1 데칼 클리어런스 / E1 프레임 회귀 / F1 콘솔 오류를 측정한다.
측정하지 못한 항목은 PASS가 아니라 NOT TESTED로 보고한다.
