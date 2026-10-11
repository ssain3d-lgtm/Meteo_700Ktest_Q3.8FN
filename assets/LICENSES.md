# Assets & Licenses

## 외부 에셋

**없음.** 이 데모는 어떤 외부 텍스처, 모델, 오디오 파일도 다운로드하거나 번들하지 않는다.
Target.md의 에셋 우선순위(1. CC0 / Public Domain → 2. 상업 허용 명확 → 3. CC-BY → 4. 불명확 금지)에 따라,
4번 위험을 완전히 제거하는 선택지로 **모든 자산을 절차적으로 생성**했다.

- 마법진 텍스처(룬 링 2종, 지오메트리 링, 코어 시길, 플로어 글로우): `src/assets/proceduralTextures.js`
  캔버스 2D 드로잉으로 런타임 생성
- 불/연기/재/먼지 스프라이트: 동일 파일, 주기적 value-noise fbm + 래디얼 감쇠
- 지면 diffuse/bump, 용암 타일, 메테오 크러스트: 동일 파일, 심 없는 반복 fbm
- 스코치/용암 균열 데칼, 하늘 균열, 충격파 링: 동일 파일
- 모든 사운드: `src/audio/meteorAudio.js`, Web Audio API 오실레이터/노이즈/필터로 합성

라이선스 기록이 필요 없는 이유: 저작물이 이 저장소에서 생성되었고 제3자 소스에 의존하지 않는다.

## 서드파티 라이브러리

| 항목 | 값 |
|---|---|
| asset name | three |
| source URL | https://github.com/mrdoob/three.js |
| author | Ricardo Cabello (mrdoob) and contributors |
| license | MIT License |
| attribution required 여부 | 아니오(라이선스 유지 조건만). `node_modules/three/LICENSE`에 사본 동봉 |
| downloaded date | 2026-10-11 (`npm install three@0.186.1`) |
| actual used filename | `node_modules/three/build/three.module.js`, `node_modules/three/examples/jsm/postprocessing/*` |

## 라이선스 없음으로 사용 금지한 항목

무료 "meteor explosion sound pack", "magic circle texture pack" 등 출처 불명 자료는
Target.md 11조 4항(라이선스 불명확 자료 사용 금지)에 따라 검색·사용하지 않았다.
