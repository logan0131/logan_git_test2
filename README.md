# logan_git_test2

## color-mix-lab/

[Color Mix Lab](https://github.com/michaelhq/color-mix-lab) (MIT) 포크에
**Rodin → 풀컬러 출력 파이프라인** 작업지시서를 구현한 브라우저 앱입니다.

- 기능 A: Rodin 3D Print(Face Color) 3MF 직접 불러오기
- 기능 B: 병합 시 그늘색 재판정 + 경계/작은 조각 정리 (Undo, 전후 비교)
- 기능 C: 노마드 왕복용 정점색 OBJ 내보내기/불러오기 (CIEDE2000 스냅)
- 기능 D: PrusaSlicer 3MF 내보내기 수정 (VE 번호 연속화, `Slic3r_PE.config` 제거, 검증, 썸네일)
- §6: 줄무늬 방지 기본값(thirds, 2색)과 실물 직결 추천

```bash
cd color-mix-lab
npm ci
npm run dev    # 개발 서버
npm test       # vitest
npm run build  # dist/
```

자세한 내용은 [color-mix-lab/README.md](color-mix-lab/README.md)를 보세요.
