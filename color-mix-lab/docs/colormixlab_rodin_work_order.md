# Color Mix Lab 확장 작업지시서: Rodin → 풀컬러 출력 파이프라인

## 0. 배경과 목표

Hyper3D Rodin의 3D Print 탭에서 받은 Face Color 3MF를 Color Mix Lab에서 바로 읽고,
색 병합과 정리를 한 번에 끝낸 뒤, PrusaSlicer(Full Spectrum)에서 추가 손질 없이
열리는 3MF로 내보내는 것이 목표다.

현재 워크플로우 (7단계, 수작업 4개)
```
Rodin → 3MF 받기 → [수동] OBJ 변환 → [수동] 색 병합+정리 → 노마드 → Color Mix Lab
→ 내보내기 → [수동] 번호 정리 + 설정 파일 제거 → PrusaSlicer
```

목표 워크플로우 (4단계, 수작업 0개)
```
Rodin → Color Mix Lab (불러오기 → 병합 → 내보내기) → (선택) 노마드 → PrusaSlicer
```

### 역할 분담

앱이 할 것
- Rodin Face Color 3MF 직접 불러오기 (기능 A)
- 병합 시 그늘색 재판정과 얼룩 정리 (기능 B)
- 노마드 왕복용 내보내기/불러오기 (기능 C)
- PrusaSlicer가 바로 읽는 3MF 내보내기 (기능 D)

사람이 할 것 (앱 밖)
- 어느 색을 어느 색과 합칠지 결정 (앱은 제안만)
- 노마드 손 터치 (눈, 경계선 등 미세 수정)
- 필라멘트 선택, 슬라이싱, 출력

---

## 1. 입력 포맷: Rodin Face Color 3MF

Rodin 3D Print 탭 → Output Mode: Face Color → Download .3mf

압축 파일 구성
```
[Content_Types].xml
_rels/.rels
3D/3dmodel.model            ← 형상 + 면별 색 (100MB급)
3D/_rels/3dmodel.model.rels
Metadata/project_settings.config   ← Bambu Studio 설정, 팔레트 색 목록 포함
Metadata/slice_info.config
```

3dmodel.model 구조 (Bambu Studio 형식)
```xml
<vertex x="..." y="..." z="..."/>
<triangle v1="0" v2="1" v3="2"
          paint_color="4"
          slic3rpe:mmu_segmentation="4"/>
```
- paint_color와 mmu_segmentation은 항상 같은 값
- 단위 mm, Z-up, 바닥 z=0
- 팔레트는 project_settings.config의 filament_colour 배열 (13색이면 13개)

### 칠하기 코드 ↔ 익스트루더 번호 (PrusaSlicer/Bambu 공통)
```
코드 "4"  → 1번
코드 "8"  → 2번
코드 "0C" → 3번,  "1C" → 4번,  "2C" → 5번 … "AC" → 13번, "BC" → 14번, "CC" → 15번
즉 3번 이상은 hex(번호-3) + "C"
```
```python
def decode(code):
    if code == "": return 0
    if code == "4": return 1
    if code == "8": return 2
    return int(code[0], 16) + 3
def encode(n):
    return "4" if n == 1 else "8" if n == 2 else f"{n-3:X}C"
```
이 인코딩 한계 때문에 최대 15색(실물 + 가상 합계)이다.

### Rodin 3MF와 Bambu/Prusa 3MF 구분
Rodin의 Texture Map 모드로 받으면 삼각형이 `pid="..."`로 텍스처를 참조하고
칠하기 코드가 없다. 이 경우 불러오기를 거부하고
"Rodin에서 Output Mode를 Face Color로 바꿔서 다시 받으세요"를 안내한다.

---

## 2. 기능 A: Rodin 3MF 불러오기

Load 탭에 "Rodin 3D Print 3MF" 항목 추가.

동작
1. zip 열어 3D/3dmodel.model 파싱 (정규식으로 충분, 70만 면 기준 수 초)
2. project_settings.config에서 filament_colour 읽어 팔레트 구성
3. 삼각형별 칠하기 코드 → 팔레트 인덱스
4. 내부 자료구조를 기존 "베이크된 정점색 OBJ" 불러온 상태와 동일하게 채운다
   - 면 색 = 팔레트 색 (정확히 13색만 존재)
   - 정점 색 = 인접 면의 최빈 팔레트 색 (평균 내지 말 것, 경계에 중간색 생김)
5. Texture Baking 탭은 건너뛰고 VertexColor 2 ColorMix로 바로 넘어갈 수 있게

참조 파싱 코드 (검증됨, 700,000면 처리)
```python
import re, zipfile, numpy as np
def load_rodin_3mf(path):
    z = zipfile.ZipFile(path)
    data = z.read("3D/3dmodel.model").decode()
    if 'slic3rpe:mmu_segmentation="' not in data:
        raise ValueError("Face Color 모드가 아닙니다. Rodin에서 Output Mode를 Face Color로 바꿔서 다시 받으세요.")
    V = np.array(re.findall(r'<vertex x="([-\d.eE]+)" y="([-\d.eE]+)" z="([-\d.eE]+)"', data), dtype=np.float64)
    tri = re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"[^>]*slic3rpe:mmu_segmentation="([0-9A-F]*)"', data)
    F = np.array([(int(a), int(b), int(c)) for a, b, c, _ in tri], np.int32)
    fil = np.array([decode(t[3]) for t in tri], np.int32)          # 1-based 팔레트 번호
    cfg = z.read("Metadata/project_settings.config").decode()
    pal = re.findall(r'"#([0-9A-Fa-f]{6})"', cfg.split('"filament_colour"')[1].split("]")[0])
    return V, F, fil, ["#" + p for p in pal]
```

정점 색 결정
```python
def vertex_colors_by_majority(F, fil, n_pal, NV):
    votes = np.zeros((n_pal + 1, NV), np.int32)
    for k in range(1, n_pal + 1):
        m = fil == k
        if m.any(): votes[k] = np.bincount(F[m].ravel(), minlength=NV)
    return votes.argmax(0)   # 각 정점의 팔레트 번호
```

---

## 3. 기능 B: 병합 시 재판정 + 정리

현재 Merge selected virtual colours는 팔레트 단위로 뭉치기만 한다.
문제: "#D6C0C3을 살색에 합치기"를 하면 흰 천 그늘, 검정 경계, 머리카락 그늘에
있던 #D6C0C3까지 전부 살색이 된다. (실측: 살색이 1.8% → 7%로 부풀었고,
그중 실제 피부는 5분의 1)

### 핵심 아이디어
합쳐지는 색을 "확실한 색"과 "그늘/경계일 수 있는 중간색"으로 나눈다.
- 확실한 색: 사용자가 합친 그룹에 그대로 고정
- 중간색: 일단 비워두고, 면 인접 관계를 따라 이어진 표면의 색을 따라가게 한다

중간색 자동 판별 기준 (제안, 사용자가 UI에서 바꿀 수 있게)
- 채도가 낮고(HSV S < 0.25) 명도가 중간(0.3 < V < 0.85)인 색
- 또는 병합 전 팔레트에서 면적 비율 3% 미만인 색
- UI: 팔레트 색 옆에 "그늘/경계 색으로 취급" 체크박스. 자동 판별은 초기값만

### 알고리즘 (검증됨)
```python
from scipy import sparse
from scipy.sparse.csgraph import connected_components

def build_adjacency(F, NV):
    NF = len(F)
    rows = np.repeat(np.arange(NF), 3)
    M = sparse.csr_matrix((np.ones(NF*3, np.float32), (rows, F.ravel())), shape=(NF, NV))
    A = (M @ M.T).tocsr(); A.setdiag(0); A.eliminate_zeros(); A.data[:] = 1
    return A            # 정점을 공유하면 인접

def merge_with_reprojection(F, fil, A, user_group, ambiguous, n_groups,
                            protect_groups=(), min_blob=None):
    """
    fil        : 면별 원본 팔레트 번호 (1-based)
    user_group : dict 팔레트번호 -> 병합 그룹 인덱스 (0-based)
    ambiguous  : set 중간색으로 취급할 팔레트 번호
    protect    : 정리에서 건드리지 않을 그룹 (빨강 포인트 등 작은 중요 색)
    min_blob   : dict 그룹 -> 이 면수 미만 조각은 주변에 흡수 (기본 아래 참조)
    """
    NF = len(F)
    naive = np.array([user_group[k] for k in fil], np.int32)
    g = naive.copy()
    amb = np.isin(fil, list(ambiguous))
    g[amb] = -1

    def onehot(g):
        o = np.zeros((NF, n_groups), np.float32); m = g >= 0
        o[np.where(m)[0], g[m]] = 1; return o

    # 1) 중간색: 이어진 면의 다수결을 따라 채워나감
    for _ in range(80):
        un = np.where(g < 0)[0]
        if len(un) == 0: break
        vt = np.asarray(A[un] @ onehot(g))
        vt[np.arange(len(un)), naive[un]] += 0.5   # 동률이면 사용자 병합 우선
        got = vt.sum(1) > 0.5
        if not got.any(): break
        g[un[got]] = vt[got].argmax(1)
    g[g < 0] = naive[g < 0]                          # 고립된 면은 사용자 병합대로

    # 2) 경계 톱니 정리 (3회 다수결, 보호 그룹 제외)
    prot = np.isin(g, list(protect_groups))
    for _ in range(3):
        o = onehot(g); new = (A @ o + o * 2).argmax(1)
        m = ~prot; g[m] = new[m]

    # 3) 작은 조각 흡수
    if min_blob is None:
        min_blob = {k: 150 for k in range(n_groups)}
    for k, thr in min_blob.items():
        if k in protect_groups: continue
        ids = np.where((g == k) & ~prot)[0]
        if len(ids) == 0: continue
        n, cl = connected_components(A[ids][:, ids], directed=False)
        sz = np.bincount(cl); small = sz[cl] < thr
        if not small.any(): continue
        sid, scl = ids[small], cl[small]
        vt = np.asarray(A[sid] @ onehot(g)); vt[:, k] = 0
        agg = np.zeros((cl.max() + 1, n_groups), np.float32)
        np.add.at(agg, scl, vt)
        g[sid] = agg[scl].argmax(1)
    return g
```

권장 기본값
- min_blob: 살색 60, 그 외 150, 진한 색(뿔 등) 120
- protect: 면적 1% 미만이면서 채도 높은 색 (빨간 보석 같은 포인트) 자동 보호

### 알려진 한계와 보완
그늘진 등 피부가 Rodin 팔레트에서 머리카락 그늘과 같은 회보라(#7D727A)로
묶이는 경우, 인접 다수결만으로는 피부로 못 돌린다 (등 피부가 옷에 둘러싸여
있고 앞 피부와 끊겨 있음). 보완책 두 가지 중 하나를 넣는다.
1. 원본 텍스처가 있을 때(Texture Baking 거친 경우): 원본 색조로 잡은 피부
   마스크를 함께 넘겨 `g[amb & skin_mask] = SKIN`으로 먼저 고정
2. Rodin 3MF만 있을 때: UI에서 "이 색은 살색 확정" 브러시나 영역 선택 제공,
   또는 노마드 왕복(기능 C)으로 해결

### UI
- Merge 버튼 옆에 "그늘 재판정 + 정리 포함" 토글 (기본 켜짐)
- 병합 전후 비교 렌더 (앞/뒤)와 그룹별 면적 % 변화 표시
- Undo 가능

---

## 4. 기능 C: 노마드 왕복

노마드 손 터치는 "색 개수가 확정된 뒤, 혼합 계산 전"에 들어가야
칠한 결과가 그대로 출력된다.

### C-1. 노마드용 내보내기
병합 결과를 정점색 OBJ로 내보낸다.
- 색은 병합 그룹의 대표색 N개만 (지금 예시라면 6색)
- 정점 색 = 인접 면 최빈색
- 정점을 위치 기준으로 병합하지 말 것 (노마드에서 돌아올 때 면 순서 대조에 필요)
- 파일 이름에 그룹 수 표기: `model_6colors_for_nomad.obj`

### C-2. 노마드에서 돌아온 OBJ 불러오기
노마드는 정점색 OBJ(`v x y z r g b`)로 내보낸다.
- 면 순서와 개수가 같으면 정점 색만 갱신 (형상은 원본 유지)
- 다르면 (노마드에서 리메쉬한 경우) 경고 후 전체 재불러오기
- 각 정점 색을 팔레트 N색 중 가장 가까운 색으로 스냅 (CIEDE2000)
- 스냅 거리가 ΔE 8 이상인 정점이 1% 넘으면 경고:
  "팔레트에 없는 색이 칠해져 있습니다. 노마드에서 스포이트로 기존 색만 쓰세요."
- 면 색 = 세 정점의 최빈색, 동률이면 면 중심에 가장 가까운 정점 색

### 노마드 사용 규칙 (앱 안내문으로 표시)
- 새 색 만들지 말고 스포이트로 모델 색만 찍어 칠하기
- 브러시 강도 100%, Falloff 없음, Smooth color 사용 금지
- Color 채널만 (Roughness, Metalness 끄기)
- Voxel, Decimate, 리메쉬 금지
- OBJ로 내보내기, 정점색 포함

---

## 5. 기능 D: 내보내기 수정 (버그)

### D-1. 가상 익스트루더 번호 연속화
증상: 병합 후 VE 번호가 6, 7, 9, 13, 14, 15로 빈칸이 생긴 채 내보내진다.
PrusaSlicer는 목록 순서대로 6, 7, 8, 9, 10, 11로 다시 매기므로 색이 어긋나고,
목록 개수를 넘는 번호는 1번 익스트루더(시안)로 떨어진다.

수정: 내보내기 직전에 실제 사용된 VE만 남기고
(실물 익스트루더 수 + 1)부터 연속으로 다시 매긴다.
아래 두 곳에 동일한 재매핑 적용
- `3D/3dmodel.model`의 모든 `slic3rpe:mmu_segmentation` 값
- `Metadata/Prusa_Slicer_full_spectrum.json`의 `virtual_extruders[].id`

```python
used = sorted(set(face_state) - set(range(1, n_physical + 1)))
remap = {old: n_physical + 1 + i for i, old in enumerate(used)}
```

### D-2. 프린터 설정 파일 제거
증상: `Metadata/Slic3r_PE.config`에 들어가는 임시 설정이 사용자의 XL 프린터
프로필을 덮어쓴다. `single_extruder_multi_material = 1`(MMU용)과
`use_relative_e_distances` 누락으로 XL에서 와이프 타워 오류 발생.

수정: `Slic3r_PE.config`를 아예 넣지 않는다.
(`Slic3r_PE_model.config`, `Prusa_Slicer_full_spectrum.json`,
`Prusa_Slicer_wipe_tower_information.xml`, `thumbnail.png`는 유지)
프린터 프로필은 사용자가 PrusaSlicer에서 고른 것을 쓰게 둔다.

### D-3. 내보내기 전 검증
하나라도 실패하면 내보내지 않고 에러 표시
- 칠하기에 쓰인 상태 번호 집합 == json의 VE id 집합
- VE id가 빈칸 없이 연속
- 실물 + 가상 합계 ≤ 15 (칠하기 인코딩 한계)
- 실물 익스트루더 번호는 1..n_physical 범위 안

### D-4. 썸네일 갱신
병합/정리 후 결과로 thumbnail.png를 다시 렌더한다.
(지금은 병합 전 렌더가 들어가서 슬라이서 미리보기와 다르게 보임)

---

## 6. 팔레트 설정 권장 기본값 (줄무늬 방지)

가상 익스트루더는 색을 섞는 게 아니라 층을 번갈아 쌓는 방식이라
비율 단위가 잘면 주기가 길어져 줄무늬가 보인다.
(5% 단위 → 20층 주기 → 0.05mm 층에서 1mm마다 줄)

기본값 변경
- Mixing recipe resolution: `5% + thirds` → `thirds`(또는 25%) 기본
- Max colours per virtual mixture: 3 → 2 기본
- 검정과 흰색은 자동으로 실물 익스트루더 직결 제안
  (팔레트 색과 실물 필라멘트 색의 ΔE < 6이면 "실물로 보내기" 추천 표시)

---

## 7. 검증 시나리오

테스트 파일: 오늘 작업한 티포에우스 Rodin Face Color 3MF (700,000면, 13색)

1. 기능 A: 불러온 뒤 면 색 고유값이 정확히 13개, 정점 34만 9,904개, 면 70만 개
2. 기능 B: 13색을 6그룹(흰/살/라일락/진한보라/검정/빨강)으로 병합.
   중간색 = {#A4919E, #595159, #D6C0C3, #7D727A}.
   기대: 살색 면적 7% → 약 2.2%, 흰색 6.9% → 7.5%, 빨강 보존
3. 기능 D: 내보낸 3MF를 PrusaSlicer에서 새 프로젝트로 열었을 때
   - VE 목록이 #6~#11 연속
   - 머리카락 라일락, 옷 검정, 보석 빨강으로 표시
   - XL 5T 프로필이 (수정된곳) 표시 없이 유지
   - 와이프 타워 오류 없이 슬라이스 됨
4. 기능 C: 6색 OBJ → 노마드에서 한 곳 칠하고 돌아옴 → 스냅 후 여전히 6색

---

## 8. 우선순위

1. D (내보내기 버그) — 지금 매번 수동으로 고치는 부분, 반나절
2. A (Rodin 불러오기) — 파이프라인의 입구, 반나절
3. B (재판정 병합) — 품질 핵심, 하루
4. C (노마드 왕복) — 선택 단계, 반나절
5. 6번 기본값 조정 — 1시간

---

## 9. 오늘 수작업 파일 (참고)

- `typhoeus_rodin13_vertexcolors.obj`: 기능 A 결과물 예시
- `typhoeus_XL_ready.3mf`: 기능 B + D 결과물 예시 (PrusaSlicer에서 정상 확인)
- `flatten_pipeline.py`: Texture Baking 경로용 원본 텍스처 기반 평탄화
  (Rodin 3MF 경로에서는 불필요, 피부 마스크 보완책 1번에만 참고)
