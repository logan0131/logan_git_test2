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

**가장 쉬운 방법 / easiest:** 저장소 폴더 안의 **`Rodin Pipeline 실행.command`**(Mac) 또는 **`Rodin Pipeline 실행.bat`**(Windows)을 더블클릭하세요.
Node.js가 없으면 설치 페이지를 열어 주고, 처음 한 번은 패키지를 설치한 뒤 브라우저를 자동으로 엽니다. 창을 닫으면 앱이 꺼집니다.
*Double-click the launcher in the repo folder. It installs packages on first run and opens the browser; closing the window stops the app.*


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

### 작업 저장 / Saved work

앱은 불러온 모델 파일과 현재 면 색(병합·묶음 색 바꾸기 결과)을 **브라우저(IndexedDB)에 자동 저장**하고, 다음에 켤 때 그대로 복원합니다. 상태 표시줄 오른쪽에 "자동 저장됨 시각"이 보이면 저장된 것입니다. 복원 후 **되돌리기**를 누르면 원본 색으로 돌아갑니다. 불러오기 섹션의 **새로 시작**은 모델과 저장된 작업을 지웁니다(필라멘트·병합 설정은 남음). PrusaSlicer 템플릿 3MF도 같은 방식으로 기억되며, 불러오기 섹션 아래 "PrusaSlicer 템플릿: 파일명 · 베드 크기" 줄에서 현재 물려 있는 템플릿을 확인할 수 있습니다. 저장은 브라우저·주소(포트)별로 따로 됩니다.

The app autosaves the loaded model file and the current face colours (merges, patch recolours) in the browser's IndexedDB and restores them on the next start; the status bar shows "autosaved HH:MM" once stored. After a restore, **Undo** returns to the original colours; **Start over** in the Load section clears the model and the saved work (filament and merge settings stay). The PrusaSlicer template 3MF is remembered the same way, and the "PrusaSlicer template: name · bed" line in the Load section shows which one is attached. Storage is per browser and per address (port).

### 색지도와 브러시 / Colour map and brush

미리보기 도구줄의 **색지도**를 켜면 모델 면을 2D로 펼친 지도가 옆에 나옵니다(자동 펼침, 축별 조각 배치). 3D에서 고른 조각이 지도에도 같은 색 윤곽으로 보이고, 지도에서 클릭·더블클릭·Shift+클릭으로 고른 것도 3D에 바로 반영됩니다. **브러시**를 켜면 3D와 지도 모두에서 왼쪽 드래그로 칠할 수 있고(3D 회전은 오른쪽 드래그), 한쪽의 브러시 원이 다른 쪽에도 보입니다. 기본은 "선택한 조각 안에서만"이라 선택 밖은 칠해지지 않으며, 드래그 한 번이 되돌리기 한 단계(Ctrl+Z)입니다.

**Colour map** in the preview toolbar shows the faces unwrapped into 2D (automatic per-axis charts). Patches picked in 3D are outlined on the map and picks on the map (click, double-click, Shift+click) apply to 3D. **Brush** paints with a left-drag in both the 3D view and the map (rotate 3D with the right button); the brush circle of one view is mirrored in the other. "Only inside the selected patches" is on by default so nothing outside the selection is painted, and each drag is one undo step (Ctrl+Z).

### 색 수 한계 / Colour limit

내보내기는 실물 + 가상 익스트루더 합계 **255**까지 받습니다. 작업지시서의 15는 PrusaSlicer 2.9.5 이하의 6비트 칠하기 상태(최대 15) 기준이었고, ColorMix가 들어간 PrusaSlicer 2.9.6부터는 삼각형 상태가 256개(17번 이상은 14비트 코드, `slic3rpe:MmPaintingVersion` 2)라서 XL 5T 기준 실물 5 + 가상 250까지 가능합니다. 가상 색이 많을수록 슬라이싱과 출력 시간이 늘어나니 필요한 만큼만 쓰세요. 16색 이하 파일은 2.9.6 이전 버전도 읽지만, 이 앱의 파일은 항상 2.9.6 이상용입니다.

The export accepts up to **255** physical + virtual extruders. The work order's 15 came from the 6-bit paint state of PrusaSlicer 2.9.5 and older; PrusaSlicer 2.9.6 (the ColorMix release) has 256 triangle states (ids 17+ use a 14-bit code and `slic3rpe:MmPaintingVersion` 2), so an XL 5T can carry 5 physical + 250 virtual colours in one file. More virtual colours mean longer slicing and printing. Files from this app always target PrusaSlicer 2.9.6 or newer.

### 설치 없이 쓰기 (GitHub Pages) / Hosted version

`.github/workflows/deploy-pipeline-pages.yml`이 `master`에 푸시될 때마다 `rodin-pipeline`을 빌드해 GitHub Pages에 올립니다.
저장소 **Settings → Pages → Source: GitHub Actions**로 한 번 켜 두면 `https://logan0131.github.io/logan_git_test2/`에서 바로 열립니다.
*The workflow builds and publishes `rodin-pipeline` on every push to `master`. Enable it once under Settings → Pages → Source: GitHub Actions and the app is served at `https://logan0131.github.io/logan_git_test2/`.*

## 작업지시서 / work order

`color-mix-lab/docs/colormixlab_rodin_work_order.md` — 구현 위치와 검증 내용은 [color-mix-lab/README.md](color-mix-lab/README.md), 앱 사용법은 [rodin-pipeline/README.md](rodin-pipeline/README.md).
