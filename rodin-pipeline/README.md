# Rodin Pipeline

Rodin Face Color 3MF를 넣고, 필라멘트·병합·컬러믹스 수치를 한 화면에서 정한 뒤, 미리보기를 보면서 PrusaSlicer용 3MF를 받는 앱입니다.
Color Mix Lab(`../color-mix-lab/src/workflows/vertex/core`)을 계산 엔진으로 import해서 쓰고, UI는 이 폴더에만 있습니다.

```bash
npm install            # 저장소 루트에서 / once, at the repo root
npm run dev:pipeline   # http://localhost:5173/  (또는 cd rodin-pipeline && npm run dev)
npm run build -w rodin-pipeline
```

UI는 한국어/영어를 지원합니다(우상단 **English / 한국어** 버튼, 브라우저에 기억됨). 브라우저 언어가 한국어면 한국어로 시작합니다.
*The UI is bilingual: the **English / 한국어** button in the top bar switches language and the choice is remembered. Korean browsers start in Korean, everything else in English. All strings live in `src/i18n.ts`.*

## 화면 구성

왼쪽은 5단계 패널, 오른쪽은 Three.js 미리보기(팔레트 | 출력 시뮬레이션 나란히, 앞/뒤/좌/우/위/사선), 아래는 상태 표시줄입니다.

1. **불러오기** — Rodin 3D Print 3MF(Face Color) 또는 정점색 OBJ를 끌어다 놓기. 팔레트 13색 중 사용된 색, 미칠 면, 경고를 보여줍니다. Texture Map 3MF는 거부합니다. 템플릿 3MF는 선택(베드 크기).
2. **실물 필라멘트** — 익스트루더 수(2~8), 프리셋(XL 5T 등), 슬롯별 색/이름. "모델 팔레트에서 채우기"로 큰 색부터 자동 입력.
3. **색 병합** — 팔레트 색마다 *합칠 대상*을 고르고 **병합 실행**. 그늘/경계 색은 인접 다수결로 재판정, 톱니 정리, 작은 조각 흡수. 자동 판별 기준(HSV S/V, 면적 %, 보호 기준, 최소 조각 60/120/150, 반복 횟수)은 펼침 메뉴에서 수치로 조정. 결과는 모델 면 색에 반영되고(팔레트가 실제로 줄어듦) 되돌리기 10단계, 그룹별 면적 % 표(병합 전 / 단순 병합 / 재판정 후).
4. **컬러믹스 수치** — 실물+가상 / 실물만, 혼합당 색 수(기본 2), 비율 해상도(기본 thirds), 혼합 모델, 매핑 전략, 색차 기준, 포인트 보존, 미리보기 밝기, 실물 단독 판정 비율, 실물 직결 자동(ΔE00 < 6). 가상 익스트루더 표(구성, 층 순서 막대, 팔레트 번호)와 색별 실물 직결 지정. 실물+가상 > 15면 경고.
5. **내보내기** — 파일명, 좌표(keep 기본), 배율/목표 높이, 베드 놓기/중앙, 베드 크기(XL 360×360), 기본 익스트루더, 템플릿 프린터 설정 포함(기본 끔). 내보내기 전 검증 결과(VE 연속, ≤ 15, 상태 집합 일치, 실물 범위)를 항상 표시하고 실패하면 버튼이 잠깁니다. 노마드 왕복(OBJ 내보내기/불러오기, 규칙)도 여기에 있습니다.

모든 수치는 브라우저(localStorage)에 자동 저장되고, 상단의 **설정 저장/불러오기**로 JSON 파일로 주고받을 수 있습니다.

## 엔진과의 관계

| 앱 단계 | 엔진 모듈 |
| --- | --- |
| 불러오기 | `rodin3mf.ts`, `objParser.ts`, `template3mf.ts` |
| 팔레트 | `quantize.ts` (median cut, 정확한 색이면 그대로) |
| 병합 | `meshAdjacency.ts`, `mergeReprojection.ts` |
| 컬러믹스 | `virtualExtruders.ts`, `assignmentOverrides.ts`, `prusaFdmMixer.ts` |
| 내보내기 | `export3mf.ts`, `paintCodes.ts`, `modelThumbnail.ts` |
| 노마드 | `nomadRoundTrip.ts` |

## 검증

- `npm test`(엔진 단위 테스트 41개) 통과.
- Playwright로 빌드된 앱을 실제 브라우저에서 구동: 합성 Rodin 3MF 로드 → 프리셋 → #D6C0C3, #7D727A를 살색에 병합(살색 33.2% → 단순 병합 38.0% → 재판정 34.9%, 흰색 31.8% → 35.0%) → 되돌리기 → 3MF 내보내기(연속 VE, `Slic3r_PE.config` 없음, PNG 썸네일) → 노마드 OBJ 왕복 → 새로고침 후 설정 유지, 콘솔 오류 0건.
- 실제 70만 면 Rodin 파일과 PrusaSlicer 실기 확인은 아직입니다.

---

## English summary

**Rodin Pipeline** is the one-screen app for the Rodin → PrusaSlicer full-colour workflow. Load a Rodin Face Color 3MF (or vertex-colour OBJ), set the physical filaments, merge palette colours with shade re-judgement and cleanup, tune the colour-mix numbers (thirds recipes and 2 colours per mixture by default, Prusa FDM mixer, physical-direct rule for black/white), watch the palette and print simulation side by side in the Three.js viewer, and export a PrusaSlicer Full Spectrum 3MF with contiguous virtual extruder ids and no `Slic3r_PE.config` (so your XL profile stays untouched). The Nomad round trip (export/import of an N-colour vertex OBJ with CIEDE2000 snapping) lives in the Export panel. All settings persist in the browser and can be saved/loaded as JSON. The computation is the Color Mix Lab core in `../color-mix-lab/src/workflows/vertex/core`.
