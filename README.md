# logan_git_test2

Rodin(Face Color 3MF) → 색 병합 → 컬러믹스 → PrusaSlicer(Full Spectrum) 3MF 파이프라인.
*Rodin (Face Color 3MF) → colour merge → colour mix → PrusaSlicer (Full Spectrum) 3MF pipeline.*

```
Rodin → rodin-pipeline 앱 (불러오기 → 필라멘트 → 병합 → 컬러믹스 수치 → 미리보기 → 내보내기) → (선택) 노마드 → PrusaSlicer
```

| 폴더 / folder | 내용 / contents |
| --- | --- |
| `rodin-pipeline/` | **우리 앱 / the app.** 한 화면에서 모든 수치를 입력하고 미리보기와 3MF 내보내기까지 끝내는 React/Three.js 앱. 한국어/영어 전환 버튼 있음. Calculation runs on the Color Mix Lab engine below. |
| `color-mix-lab/` | [michaelhq/color-mix-lab](https://github.com/michaelhq/color-mix-lab) (MIT) 포크. 작업지시서 기능 A–D를 `src/workflows/vertex/core/`에 구현. Fork used as the engine; the original UI still works too. |

## 실행 / How to run

필요한 것은 **Node.js 20 이상**뿐입니다 (https://nodejs.org). 터미널에서:
*You only need **Node.js 20+**. In a terminal:*

```bash
git clone https://github.com/logan0131/logan_git_test2.git
cd logan_git_test2
git checkout claude/request-6vvekr   # 아직 master에 합치기 전이면 / until it is merged into master
npm install                          # 저장소 루트에서 한 번 / once, at the repo root
npm run dev:pipeline                 # 그다음 브라우저에서 / then open  http://localhost:5173/
```

브라우저 우상단 **English / 한국어** 버튼으로 언어를 바꿉니다. 모든 처리는 브라우저 안에서 끝나고 파일은 서버로 올라가지 않습니다.
*Use the **English / 한국어** button in the top bar to switch language. Everything runs inside the browser; no file leaves your machine.*

그 밖의 명령 / other commands:

```bash
npm run dev:cml       # 원본 Color Mix Lab UI (엔진 확인용) → http://localhost:5173/color-mix-lab/
npm test              # 엔진 단위 테스트 / engine unit tests (vitest, 41)
npm run build         # 두 앱 빌드 / build both apps (rodin-pipeline/dist, color-mix-lab/dist)
npx vite preview -w rodin-pipeline   # 빌드 결과 미리보기 / serve the built app
```

### 설치 없이 쓰기 (GitHub Pages) / Hosted version

`.github/workflows/deploy-pipeline-pages.yml`이 `master`에 푸시될 때마다 `rodin-pipeline`을 빌드해 GitHub Pages에 올립니다.
저장소 **Settings → Pages → Source: GitHub Actions**로 한 번 켜 두면 `https://logan0131.github.io/logan_git_test2/`에서 바로 열립니다.
*The workflow builds and publishes `rodin-pipeline` on every push to `master`. Enable it once under Settings → Pages → Source: GitHub Actions and the app is served at `https://logan0131.github.io/logan_git_test2/`.*

## 작업지시서 / work order

`color-mix-lab/docs/colormixlab_rodin_work_order.md` — 구현 위치와 검증 내용은 [color-mix-lab/README.md](color-mix-lab/README.md), 앱 사용법은 [rodin-pipeline/README.md](rodin-pipeline/README.md).
