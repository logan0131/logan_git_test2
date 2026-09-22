# Color Mix Lab — Rodin → 풀컬러 출력 파이프라인 확장

이 디렉터리는 [michaelhq/color-mix-lab](https://github.com/michaelhq/color-mix-lab) (MIT, 커밋 `6b726e7`)을
가져와 **Rodin → Color Mix Lab → PrusaSlicer(Full Spectrum)** 작업지시서(`docs/colormixlab_rodin_work_order.md`)의
기능 A–D와 6번(팔레트 기본값)을 구현한 포크입니다. 원본 README는 아래 "Color Mix Lab" 절부터 이어집니다.

```
Rodin(Face Color 3MF) → Color Mix Lab (불러오기 → 병합 → 내보내기) → (선택) 노마드 → PrusaSlicer
```

## 실행

```bash
npm install            # 저장소 루트에서 (npm workspaces: color-mix-lab + rodin-pipeline)
npm run dev:cml        # http://localhost:5173/color-mix-lab/
npm run build -w color-mix-lab
npm test               # vitest: 41 tests (paint codes, Rodin loader, merge, Nomad, export)
```

수치 입력부터 내보내기까지 한 화면에서 끝내는 별도 앱은 `../rodin-pipeline/`에 있습니다. 이 폴더의 `core/`가 그 앱의 엔진입니다.

## 작업지시서 ↔ 구현 위치

| 작업지시서 | 구현 | UI 위치 |
| --- | --- | --- |
| §1 칠하기 코드 ↔ 익스트루더 번호 | `src/workflows/vertex/core/paintCodes.ts` (`encodePaintCode` / `decodePaintCode`, 최대 255색 상수 `MAX_PAINTABLE_EXTRUDER_ID`) | – |
| §2 기능 A: Rodin 3MF 불러오기 | `core/rodin3mf.ts` (`loadRodin3mf`) | VertexColor 2 ColorMix → **Load** 탭 → "Rodin 3D Print 3MF (Face Color)" |
| §3 기능 B: 병합 시 재판정 + 정리 | `core/meshAdjacency.ts`, `core/mergeReprojection.ts` (`mergeWithReprojection`) | **Palette** 탭 → Edit virtual extruders → "Merge selected" + "Re-judge shade colours + clean up" 토글, "Shade re-judgement and cleanup" 패널 |
| §4 기능 C: 노마드 왕복 | `core/nomadRoundTrip.ts` (`buildNomadObj`, `parseNomadObj`, `applyNomadObjToModel`) | **Export** 탭 → "Nomad Sculpt round trip (optional)" |
| §5 기능 D: 내보내기 수정 | `core/export3mf.ts` (`buildExportAssignments`, `validateExportAssignments`), `core/modelThumbnail.ts` | **Export** 탭 → "Export 3MF", "Include printer config from template" 체크박스(기본 꺼짐) |
| §6 팔레트 기본값 | `App.tsx` 기본값(`thirds`, 2색), ΔE00 < 6 실물 직결 추천 | **Palette** 탭 → 설정 기본값, "Recommended direct physical assignments" |

### 기능 A — Rodin Face Color 3MF 불러오기

- `3D/3dmodel.model`의 `<vertex>` / `<triangle>`을 정규식으로 파싱하고 `slic3rpe:mmu_segmentation`(없으면 `paint_color`)을 §1 표로 디코드합니다. 속성 순서와 무관하며, 빌드 아이템 transform과 `p:path`로 분리된 오브젝트 파일(`3D/Objects/*.model`)도 따라갑니다.
- 팔레트는 `Metadata/project_settings.config`의 `filament_colour`에서 읽습니다(JSON 파싱 실패 시 텍스트 스캔). 파일이 없거나 짧으면 자리표시 색을 채우고 경고를 표시합니다.
- 면 색 = 팔레트 색 그대로(예: 13색이면 정확히 13개), 정점 색 = 인접 면의 **최빈** 팔레트 색(평균 금지, 동률은 낮은 번호).
- `pid`/`p1`만 있는 Texture Map 3MF는 거부하고 "Rodin에서 Output Mode를 Face Color로 바꿔서 다시 받으세요"를 표시합니다.
- 불러온 뒤 상태는 베이크된 정점색 OBJ를 불러온 것과 동일하므로 Texture Baking 없이 바로 Physical colours → Palette로 진행합니다. 좌표 모드는 `keep`으로 고정됩니다(mm, Z-up, 바닥 z=0).

### 기능 B — 병합 시 그늘색 재판정 + 정리

"Re-judge shade colours + clean up" 토글(기본 켜짐)이 켜진 상태에서 **Merge selected**를 누르면
가상 익스트루더 오버라이드 대신 병합 결과를 **모델의 면 색에 굽습니다**(팔레트가 실제로 줄어듭니다).

1. 확실한 색은 사용자 그룹에 고정, "Shade / boundary"로 체크된 색(선택된 것 중)은 비워 두고 면 인접 다수결로 채웁니다(최대 80회, 동률은 사용자 병합 +0.5, 고립된 면은 사용자 병합).
2. 경계 톱니 정리: 3회 다수결(자기 그룹 +2), "Protect" 그룹 제외.
3. 작은 조각 흡수: 그룹별 "Min. island (faces)" 미만의 연결 조각은 주변 다수 그룹으로.

- 팔레트 색별 체크박스/입력: **Shade / boundary**(자동 초기값: HSV S < 0.25 & 0.3 < V < 0.85 또는 면적 3% 미만), **Protect**(면적 1% 미만이면서 채도 ≥ 0.5), **Min. island**(살색 60, 진한 색 120, 그 외 150).
- 병합 후 그룹별 면적 % (병합 전 / 단순 병합 / 재판정 후) 표와 앞/뒤 비교 렌더가 표시되고, **Undo**로 되돌릴 수 있습니다(최근 10단계).
- 굽는 병합은 기존 수동 가상 익스트루더 편집(overrides)을 초기화합니다. 토글을 끄면 원본 앱과 같은 오버라이드 병합입니다.
- 알려진 한계(작업지시서 §3): 옷에 둘러싸여 앞 피부와 끊긴 등 피부는 인접 다수결로 못 돌립니다. 노마드 왕복(기능 C)으로 보완하세요.

### 기능 C — 노마드 왕복

- **Export OBJ**: 현재 팔레트 N색만으로 `v x y z r g b` OBJ를 씁니다(`model_<N>colors_for_nomad.obj`). 정점은 위치로 병합하지 않고 면 순서를 유지하며, 정점 색은 인접 면 최빈색입니다. 파일 머리의 `# CML palette:` 주석에 팔레트를 기록합니다.
- **Load the OBJ exported from Nomad**: 정점/면 수가 같으면 색만 갱신(형상 유지), 다르면 경고 후 전체 재불러오기. 각 정점 색을 CIEDE2000으로 팔레트에 스냅하고, ΔE ≥ 8인 정점이 1%를 넘으면 "팔레트에 없는 색이 칠해져 있습니다…" 경고. 면 색 = 세 정점 최빈색, 세 색이 다 다르면 면 중심에 가장 가까운 정점 색.
- 노마드 사용 규칙 5가지는 패널의 "Nomad usage rules"에 표시됩니다.

### 기능 D — 내보내기 수정

- **D-1** 실제 사용된 VE만 남기고 `(실물 수 + 1)`부터 연속 번호로 다시 매깁니다. `3D/3dmodel.model`의 모든 `slic3rpe:mmu_segmentation`과 `Prusa_Slicer_full_spectrum.json`의 `virtual_extruders[].id`에 같은 재매핑을 적용하며, 상태 표시줄에 `VE9→VE8` 같은 재번호 내역을 보여줍니다.
- **D-2** `Metadata/Slic3r_PE.config`를 기본으로 넣지 않습니다(생성형 최소 설정도 폐기). 3MF 템플릿을 불러온 경우에만 "Include printer config from template" 체크로 옵트인할 수 있습니다. `Slic3r_PE_model.config`, `Prusa_Slicer_full_spectrum.json`, `Prusa_Slicer_wipe_tower_information.xml`, `thumbnail.png`는 유지됩니다.
- **D-3** 내보내기 전 검증(하나라도 실패하면 파일을 만들지 않고 에러): 칠하기 상태 집합 == JSON VE id 집합, VE id 연속, 실물 + 가상 ≤ 255, 실물 번호 1..n_physical, 미칠 삼각형 없음.
- **D-4** 썸네일은 병합/정리 후의 **유효 색**(가상 혼합 미리보기 색 또는 실물 필라멘트 색)으로 다시 렌더합니다.

### §6 팔레트 기본값

- Mixing recipe resolution 기본 `Thirds only`, Max. colours per virtual mixture 기본 `2`.
- 팔레트 색이 실물 필라멘트 색과 ΔE00 < 6이면 가상 행에 `→ E{n} physical` 배지가 붙고, "Apply recommendations" 버튼으로 한 번에 실물 직결로 보냅니다.

## 검증

- `npm test`: §7 시나리오를 합성 메시로 재현합니다 — 13색 팔레트 로드/정점 최빈색, Texture Map 거부, 그늘 패치 재판정(흰 천 안의 #D6C0C3 → 흰색), 보호 색 유지, 작은 조각 흡수, 노마드 왕복 후 색 수 유지, VE 6,7,9,13,14,15 → 6..11 연속화, `Slic3r_PE.config` 부재, 15색 초과 거부.
- 브라우저 스모크(Playwright, 저장소에는 포함하지 않음): 합성 Rodin 3MF 3,600면을 불러와 병합 → Undo → 3MF 내보내기(연속 VE, 설정 파일 없음, PNG 썸네일) → 노마드 OBJ 내보내기/재불러오기까지 콘솔 오류 없이 통과.
- 실제 `typhoeus` 700,000면 파일은 이 환경에 없어 성능/메모리(100 MB XML 문자열 + 인접 그래프 약 40 MB)는 실기 확인이 필요합니다.

## 참고 사항

- 프로젝트 저장(JSON)에는 OBJ만 내장됩니다. Rodin 3MF는 외부 파일로 두고 "Reload data"로 다시 읽습니다.
- 색 수 제한은 `MAX_PAINTABLE_EXTRUDER_ID`(paintCodes.ts) 한 곳에서 바꿉니다. 작업지시서의 15는 PrusaSlicer 2.9.5 이하의 6비트 칠하기 상태 기준이었고, ColorMix가 들어간 2.9.6부터는 상태가 256개(`TRIANGLE_STATE_TYPE_COUNT = 256`, 17번 이상은 14비트 `xxEC` 코드 + `slic3rpe:MmPaintingVersion` 2)라서 실물 + 가상 255까지 받습니다. 지금은 255에서 막습니다.
- Texture Baking 경로의 원본 텍스처 기반 피부 마스크 보완(§3 보완책 1)은 넣지 않았습니다. 필요하면 `mergeWithReprojection`의 `faceLabels`를 채우기 전에 마스크로 그룹을 고정하면 됩니다.

---

# Color Mix Lab

**Color Mix Lab** is a browser-based tool for converting textured or vertex-coloured 3D models into PrusaSlicer-compatible 3MF projects using virtual colour and extruder mixes.

**Try the live app:** [Color Mix Lab Github Page](https://michaelhq.github.io/color-mix-lab/)

**Download the bust of Nefertiti Colot Mix Lab project files:** [Nefertiti ColorMix - created with Color Mix Lab](https://www.printables.com/model/1764574-nefertiti-colormix-created-with-color-mix-lab/)

It is an experimental lab and reference workflow for preparing colour-rich 3D models for PrusaSlicer ColorMix / virtual extruder workflows.

> **Status:** Experimental lab project. Not a supported production tool.

<!-- Screenshot suggestion:
Main application overview showing the Color Mix Lab interface.
-->
<img src="https://raw.githubusercontent.com/michaelhq/color-mix-lab/main/docs/screenshots/color-mix-lab-overview.png" alt="Color Mix Lab overview" width="900">

---

## What is Color Mix Lab?

Many 3D models contain colour information as textures, materials, or vertex colours. At the time this tool was created, PrusaSlicer did not directly convert arbitrary textured models into virtual colour mixes for the ColorMix workflow. This may change in future PrusaSlicer releases. Color Mix Lab provides an experimental workflow for converting these model colours into a PrusaSlicer-compatible 3MF project.

The app has two main parts:

- **Texture Baking** converts texture or material colours into baked model colours.
- **VertexColor 2 ColorMix** converts baked or vertex-coloured models into reduced palettes, physical colour assignments, virtual blends, print simulations, and PrusaSlicer 3MF exports.

The intended workflow is:

**Textured model → baked colours → reduced target palette → physical colours → virtual blends → PrusaSlicer 3MF**

Selected capabilities:

- combine Texture Baking and VertexColor 2 ColorMix in one browser-based app,
- configure up to eight physical extruders,
- import filament colour lists and generate model-based filament colour proposals,
- generate a reduced target palette that is independent of the number of physical extruders,
- generate effective virtual blends for PrusaSlicer ColorMix / virtual extruder workflows,
- preview the reachable colour approximation using an FDM-oriented mixer model,
- use 3MF templates to preserve printer and filament-slot configuration,
- process models locally in the browser without a server-side workflow.

Color Mix Lab is not a general full-colour slicer. It is a focused lab tool for this specific texture/vertex-colour to PrusaSlicer ColorMix workflow.

---

## Main workflows

Color Mix Lab contains two related but separate workflows.

### Texture Baking

The **Texture Baking** workflow is used for models that contain texture or material colours but do not yet contain directly usable baked colour information.

Texture Baking converts visible texture or material colours into baked model colours. These baked colours can then be used in the VertexColor 2 ColorMix workflow.

This workflow is useful when a model looks coloured in a 3D viewer, but the colour information is stored in textures rather than in geometry-level colour data.

For supported file types, see [Supported inputs](#supported-inputs).

<img src="https://raw.githubusercontent.com/michaelhq/color-mix-lab/main/docs/screenshots/texture-baking-workflow.png" alt="Texture Baking workflow" width="900">


### VertexColor 2 ColorMix

The **VertexColor 2 ColorMix** workflow is used for models that already contain baked or vertex-level colour information.

VertexColor 2 ColorMix reduces the model colours, maps them to physical and virtual extruder colours, previews the reachable colour approximation, and exports a 3MF project intended for PrusaSlicer.

This workflow can be used independently of Texture Baking. For example, a model baked in Blender can be loaded directly into VertexColor 2 ColorMix.

For supported file types, see [Supported inputs](#supported-inputs).

<img src="https://raw.githubusercontent.com/michaelhq/color-mix-lab/main/docs/screenshots/vertex-color-workflow_01.png" alt="Vertex Color 2 ColorMix workflow" width="900">

---

## Typical workflow

A typical full workflow starts with a textured model and ends with a PrusaSlicer-compatible 3MF project.

1. **Load textured model**  
   Load a GLB or OBJ/MTL model with textures into the Texture Baking workflow.

2. **Apply bake colour correction**  
   Adjust colour correction settings if the texture colours need to be corrected before baking.

3. **Bake colours**  
   Convert the visible texture or material colours into baked model colours.

4. **Send to VertexColor 2 ColorMix**  
   Transfer the baked model to the VertexColor 2 ColorMix workflow.

5. **Configure physical colours**  
   Select the number of physical extruders and assign real filament colours manually or from a filament list.

6. **Generate palette and virtual mixes**  
   Generate the reduced target palette and the effective virtual colour blends.

7. **Export PrusaSlicer 3MF**  
   Export a 3MF project for PrusaSlicer, optionally based on a 3MF template.

8. **Inspect in PrusaSlicer**  
   Open the exported 3MF in PrusaSlicer and check all printer, filament, extruder, wipe, and preview settings before printing.

<img src="https://raw.githubusercontent.com/michaelhq/color-mix-lab/main/docs/screenshots/vertex-color-workflow_02.png" alt="Vertex Color 2 ColorMix workflow" width="900">

---

## Supported inputs

| Type | Supported | Workflow / purpose |
| --- | --- | --- |
| GLB | Yes | Texture Baking |
| OBJ + MTL + textures | Yes | Texture Baking |
| OBJ with vertex colours | Yes | VertexColor 2 ColorMix |
| Baked OBJ model | Yes | VertexColor 2 ColorMix |
| 3MF template | Yes | Recommended for PrusaSlicer export |
| Filament CSV | Yes | Physical colour proposal and colour reference |
| STL | No | STL does not contain colour information |
| Generic 3MF model import | No | 3MF is used as a template/export format, not as a general colour-model import workflow |

The practical result depends strongly on the structure and quality of the input model. Clean geometry, valid UV maps, correctly assigned textures, and consistent colour data improve the result.

---

## Supported outputs

| Output | Supported | Notes |
| --- | --- | --- |
| PrusaSlicer-compatible 3MF project | Yes | Main export target |
| Baked model data for internal handoff | Yes | Used between Texture Baking and VertexColor 2 ColorMix |
| General full-colour slicer project | No | Color Mix Lab is not a full-colour slicer |
| Universal slicer-compatible 3MF | No | The 3MF export is intended for PrusaSlicer |

For export details and the recommended PrusaSlicer inspection checklist, see [PrusaSlicer / 3MF export](#prusaslicer--3mf-export).

---

## Key concepts

### Reduced target palette

The **reduced target palette** describes the important colours of the model after colour reduction.

It is the target colour set that the model should preserve as well as possible. It is not limited to the number of physical extruders.

For example, a model may have a reduced target palette of 64 or 128 colours, while the printer may only have five or eight physical filament colours. The target palette describes the model. The physical colours describe the printer setup.

The reduced target palette should:

- preserve dominant colours,
- preserve visually important accent colours,
- merge very similar colours where reasonable,
- provide useful colour targets for virtual blend generation.

### Physical colours

**Physical colours** are the real filament colours available in the printer.

They correspond to the actual loaded filaments or extruder slots, for example cyan, magenta, yellow, white, black, grey, brown, red, or any manually selected filament colour.

Physical colours define the available colour basis from which virtual blends can be generated.

### Virtual extruders

**Virtual extruders** are PrusaSlicer-side colour entries that represent a mix of physical extruders.

Instead of using only the real filament slots, PrusaSlicer can represent additional virtual colour entries by combining physical extruders according to defined mixing ratios.

Color Mix Lab uses this concept to approximate more model colours than would be possible with the physical filaments alone.

### Effective virtual blends

**Effective virtual blends** are the actual reachable colour mixes generated from the selected physical colours.

They represent the colours that Color Mix Lab can approximate with the configured physical filament set and the supported virtual mixing logic.

The effective virtual blends are therefore different from the reduced target palette:

- The **reduced target palette** describes the desired model colours.
- The **effective virtual blends** describe the colours that are reachable with the selected physical filaments and virtual mixing constraints.

<img src="https://raw.githubusercontent.com/michaelhq/color-mix-lab/main/docs/screenshots/vertex-color-workflow_04.png" alt="Vertex Color 2 ColorMix workflow" width="900">

### Print simulation

The **print simulation** previews how the model may look after mapping the reduced target palette to the available physical colours and effective virtual blends.

The print simulation is a diagnostic approximation, not a guarantee of the real printed result.

It is meant to be closer to the PrusaSlicer / ColorMix concept than a simple RGB average. For practical print-related caveats, see [Limitations](#limitations).

### Prusa FDM Mixer preview model

Color Mix Lab uses a local, dependency-free implementation of Prusa’s calibrated `prusa-fdm-mixer` v7 model rather than a simple RGB or sRGB layer average. The implementation is kept inside Color Mix Lab and is verified against the current upstream TypeScript reference predictions.

This matters because FDM colour mixing is not just a mathematical RGB blend. Real filament mixing is affected by material behaviour, layer interaction, pigment strength, and the way the slicer represents virtual mixes.

Palette mapping can use either **CIE76 (ΔE76 – Euclidean LAB)** or **CIEDE2000 (ΔE00 – Perceptual)**. **CIE** refers to the *Commission Internationale de l’Éclairage* (International Commission on Illumination), which standardises colour spaces and colour-difference methods. CIE76 was introduced with CIELAB in 1976 and calculates the straight-line Euclidean distance between two Lab colours, treating differences in L* (lightness), a* (green–red) and b* (blue–yellow) equally. CIEDE2000 is the CIE Delta E 2000 formula and applies perceptual corrections to lightness, chroma and hue because equal numerical distances in CIELAB are not perceived equally in every colour region. **CIEDE2000 is the default**. This selection changes how target colours are matched to printable physical and virtual mixtures; it does not change the FDM mixing model itself.

The preview should therefore be understood as a slicer-oriented approximation, not as an exact optical simulation.

---

## Filament lists

Color Mix Lab can import filament colour lists, for example from CSV exports.

The app is not intended to be a filament database. It does not try to manage spools, stock, purchase data, or detailed filament profiles.

Instead, filament lists are used as external colour reference data.

A filament list can be used to:

- select real filament colours,
- propose physical colour sets,
- compare available filaments against model colours,
- provide colour values for virtual blend generation.

Possible external sources include:

- Filament-DB,
- OpenPrintTagDB-based colour data,
- manually maintained CSV files.

Color Mix Lab uses filament colours only as input for colour selection, proposal, and mixing calculations. The slicer’s actual filament profiles remain part of PrusaSlicer and, where applicable, the selected 3MF template.

<img src="https://raw.githubusercontent.com/michaelhq/color-mix-lab/main/docs/screenshots/vertex-color-workflow_03.png" alt="Vertex Color 2 ColorMix workflow" width="900">

---

## PrusaSlicer / 3MF export

Color Mix Lab exports 3MF projects intended for PrusaSlicer.

The ColorMix / virtual extruder workflow targeted by Color Mix Lab is based on PrusaSlicer 2.9.6 development releases. Earlier PrusaSlicer releases, including 2.9.5, do not provide the same ColorMix workflow.

The export can use an existing 3MF template to preserve printer-specific settings. This is recommended because printer, filament, and extruder settings are usually more reliable when they come from a known working PrusaSlicer project.

A 3MF template can help preserve:

- printer profile settings,
- physical extruder count,
- filament slot definitions,
- filament profile references,
- wipe and purge settings,
- PrusaSlicer metadata,
- printer-specific configuration.

Color Mix Lab focuses on adding or updating the colour-mix-related parts required for the generated model and virtual extruder workflow.

After export, the 3MF should be checked in PrusaSlicer.

Recommended checks:

- physical extruder count,
- virtual extruder entries,
- physical filament colours,
- virtual colour blends,
- filament profile assignments,
- purge and wipe configuration,
- model placement,
- slicer preview,
- estimated filament changes,
- estimated print time,
- estimated waste.

Compatibility with other slicers is not a goal.

<img src="https://raw.githubusercontent.com/michaelhq/color-mix-lab/main/docs/screenshots/prusaslicer_editor.png" alt="Prusa Slicer Editor" width="900">
<img src="https://raw.githubusercontent.com/michaelhq/color-mix-lab/main/docs/screenshots/prusaslicer_preview.png" alt="Prusa Slicer Preview" width="900">

---

## Limitations

Color Mix Lab is experimental and has several important limitations.

### Browser-based processing

All processing happens in the browser on the user's own computer. No server-side processing is required for the core workflow.

The app was developed and tested primarily in Firefox. Firefox was the main browser used during development and iterative testing.

Chrome, Edge, and Safari were not tested as extensively. They may work, but behaviour, memory use, WebGL performance, file handling, and rendering stability can differ between browsers and operating systems.

Performance depends on both the local system and the complexity of the processed model.

Relevant local system factors include:

- CPU performance,
- GPU performance,
- available RAM,
- graphics driver,
- browser engine.

Relevant model and workload factors include:

- model size,
- triangle count,
- texture resolution,
- number of colours,
- number of virtual blends.

A fast CPU, a capable GPU, and sufficient RAM are strongly recommended when working with large or complex models.

Models with a very high triangle count can slow down the browser significantly or exceed available memory. This is especially relevant for dense scanned models, heavily subdivided meshes, or textured models that are baked into very detailed geometry.

### FDM colour mixing and print simulation are approximate

FDM colour mixing is not exact colour reproduction. The print simulation helps evaluate whether the chosen physical colours and virtual blends are plausible, but it does not guarantee the final print appearance.

The same virtual mix can look different depending on several groups of factors:

- **Filament and material properties:** brand, material type, pigment strength, translucency, and colour consistency.
- **Slicer and process settings:** layer height, nozzle diameter, extrusion width, temperature, speed, cooling, purge volume, and wipe strategy.
- **Printer and calibration:** extrusion calibration, tool or filament change behaviour, mechanical accuracy, and general printer tuning.
- **Model and viewing conditions:** model geometry, surface orientation, lighting, and camera or viewer settings.

### PrusaSlicer-focused export

The generated 3MF is intended for PrusaSlicer and its virtual extruder / ColorMix workflow. It is not intended as a universal slicer format. For export behaviour and recommended checks, see [PrusaSlicer / 3MF export](#prusaslicer--3mf-export).

### Input model quality matters

Poorly structured models can lead to poor results.

Common issues include:

- missing textures,
- broken MTL references,
- bad UV maps,
- non-manifold geometry,
- extremely dense meshes,
- inconsistent vertex colours,
- transparent or complex materials that do not bake cleanly.

### Not a maintained product

Color Mix Lab is provided as a lab and reference implementation. As stated at the top of this README, it is not intended to be maintained as a supported product. Issues may not be answered.

---

## Installation / local development

Color Mix Lab is a Node.js / Vite-based browser application.

Install dependencies:

```bash
npm ci
```

Start the local development server:

```bash
npm run dev
```

Build the app:

```bash
npm run build
```

The production build is generated in the `dist/` directory.

For source packages, `dist/` and `node_modules/` do not need to be included.

---

## GitHub Pages deployment

Color Mix Lab can be deployed as a static web application, for example with GitHub Pages.

A typical deployment flow is:

```bash
npm ci
npm run build
```

Then deploy the generated `dist/` directory using the GitHub Pages setup of the repository.

The exact deployment configuration depends on the repository structure and Vite base path configuration.

---

## Development background

Color Mix Lab started as an experimental attempt to make richly coloured 3D models usable for multi-material FDM printing.

The original motivation goes back to 2022, when I saw the coloured Bust of Nefertiti on the Prusa3D website as part of the promotion for the MMU2S with the MK3S. That image was one of the reasons why I wanted a Prusa printer in the first place: I wanted to print models like that in multiple colours. At that time, however, my printer setup was not yet ready for this workflow. I later purchased an MMU2S together with a Prusa MK3S+, but never installed it. Only after setting up an MMU3 on a Prusa MK4S did the idea become practical enough to revisit.

Another trigger was a visit to a Yayoi Kusama exhibition. I wanted to print a polka-dot pumpkin and found suitable textured models on Sketchfab. The key question was how to bring such a textured model into PrusaSlicer while preserving its colours.

I then found workflows describing texture baking in Blender and importing textured OBJ/MTL models into Bambu Studio. These workflows worked in principle, but using them with only five physical colours was tedious and not very practical. The idea was put aside again for a while.

With the introduction of ColorMix / FDM Mixer concepts in PrusaSlicer, the topic became interesting again. I experimented with the Nefertiti model, Blender, the current Bambu Studio, and also looked at the OrcaSlicer-FullSpectrum fork. The colours could be displayed there, but not as virtual extruders in the same way as PrusaSlicer handles them.

The first working prototype was a Python script with a graphical user interface. It already produced convincing results and gradually grew to include additional features, such as loading filament lists with colour data, using CSV exports from Filament-DB, importing colours based on OpenPrintTag data, and using 3MF templates for specific printer configurations.

After dozens of Python-script iterations, roughly 40 by my own count, the tool was rebuilt as a browser-based Node.js application, inspired by small web-based colour tools such as Color Mix Shading. The two main workflows were initially developed as separate apps: one for texture baking and one for converting already baked or vertex-coloured models into PrusaSlicer-compatible 3MF projects. They were later merged into a single application so that both workflows can be used independently or combined.

The subsequent browser-based app also went through more than 180 iterations: developed, tested, adjusted, and tested again, mainly in Firefox. The development process was heavily AI-assisted and highly iterative. One practical limitation was the maximum ChatGPT conversation length. Several times, the work had to continue in a new chat, which meant that project context had to be reconstructed and already clarified details had to be explained again. This added friction to the development process and occasionally made the iteration cycle more cumbersome than expected.

The result is not a polished production tool, but a lab environment for experimenting with colour reduction, virtual extruder generation, filament-based colour matching, texture baking, and PrusaSlicer 3MF export.

The results that can be achieved with Color Mix Lab are promising. However, practical printing with MMU3 is still limited by filament waste and long tool-change times. The workflow will likely become more attractive with systems such as INDX and eight physical extruders. Unfortunately, I could not order an INDX in April; I was too slow. A small Nefertiti test print was already produced using an earlier Python-script version of the workflow.

Color Mix Lab is shared in the hope that others may find the approach useful and continue developing it.

---

## Acknowledgements

Color Mix Lab builds on ideas, tools, and workflows from the broader 3D printing and open-source ecosystem.

Acknowledgements include:

- PrusaSlicer and Prusa Research for the ColorMix / virtual extruder workflow.
- The `prusa-fdm-mixer` work as a basis for a more realistic FDM-oriented preview model.
- Blender and its texture baking workflows.
- Three.js and related browser-based 3D technologies.
- Filament-DB as a useful source for externally maintained filament lists.
- OpenPrintTagDB as a source of filament colour reference data.
- Existing community discussions and examples around OBJ/MTL texture workflows.
- OrcaSlicer-FullSpectrum as a related slicer fork exploring mixed-colour filament workflows.
- Browser-based colour tools such as Color Mix Shading.

Reference links:

- Bambu Lab OBJ/MTL workflow discussion: https://forum.bambulab.com/t/how-do-you-do-the-new-obj-with-mtl-feature/75622/12
- Blender: https://www.blender.org/
- Bust of Nefertiti model: https://sketchfab.com/3d-models/bust-of-nefertiti-foia-results-8c60faca6152405e9d35784efa8b9aa1
- Color Mix Shading: https://gzeus.github.io/Color-Mix-Shading/
- Filament-DB: https://github.com/hyiger/filament-db/releases
- Kusama-style pumpkin model search: https://sketchfab.com/search?q=Kusama+pumpkin&type=models
- OpenPrintTagDB: https://github.com/OpenPrintTag/OpenPrintTagDB
- OrcaSlicer-FullSpectrum: https://github.com/ratdoux/OrcaSlicer-FullSpectrum
- Prusa FDM Mixer: https://prusa3d.github.io/prusa-fdm-mixer/
- PrusaSlicer 2.9.6 releases on GitHub: https://github.com/prusa3d/PrusaSlicer/releases
- Texture baking workflow video: https://www.youtube.com/watch?v=8_snhrVIcy4
- Three.js: https://threejs.org/

---

## License

This project is licensed under the MIT License.

See the `LICENSE` file for details.

