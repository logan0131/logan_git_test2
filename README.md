# logan_git_test2

Rodin(Face Color 3MF) → 색 병합 → 컬러믹스 → PrusaSlicer(Full Spectrum) 3MF 파이프라인.

```
Rodin → rodin-pipeline 앱 (불러오기 → 필라멘트 → 병합 → 컬러믹스 수치 → 미리보기 → 내보내기) → (선택) 노마드 → PrusaSlicer
```

| 폴더 | 내용 |
| --- | --- |
| `rodin-pipeline/` | **우리 앱.** 한 화면에서 모든 수치를 입력하고 미리보기와 3MF 내보내기까지 끝내는 React/Three.js 앱. 계산은 아래 Color Mix Lab 엔진을 그대로 씁니다. |
| `color-mix-lab/` | [michaelhq/color-mix-lab](https://github.com/michaelhq/color-mix-lab) (MIT) 포크. 작업지시서 기능 A–D(Rodin 3MF 로더, 재판정 병합, 노마드 왕복, 내보내기 수정)를 `src/workflows/vertex/core/`에 구현했고, 원본 UI에도 붙어 있습니다. |

## 실행

```bash
npm install                 # 저장소 루트에서 한 번 (npm workspaces)
npm run dev:pipeline        # http://localhost:5173/  ← 우리 앱
npm run dev:cml             # http://localhost:5173/color-mix-lab/  ← 원본 Color Mix Lab UI (엔진 확인용)
npm test                    # 엔진 단위 테스트 (vitest, 41개)
npm run build               # 두 앱 모두 빌드 (각 폴더의 dist/)
```

## 작업지시서

`color-mix-lab/docs/colormixlab_rodin_work_order.md` — 구현 위치와 검증 내용은 [color-mix-lab/README.md](color-mix-lab/README.md), 앱 사용법은 [rodin-pipeline/README.md](rodin-pipeline/README.md).
