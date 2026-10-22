# 앱 아이콘

선택한 가로 합류 심볼을 밝은 바탕 위에 배치한다. 청록색 두 톤과 얕은 반사만 유지하며, 과도한 유리 효과를 중첩하지 않는다.

심볼은 내장 이미지 생성 도구의 편집 모드로 분리했다. 편집 지시는 승인된 이미지의 형태·가로 방향·두 색·얕은 반사를 유지하고 배경 타일과 외곽 생성 흔적 및 배경 그림자만 투명하게 제거하는 것이었다. 이후 배경과 플랫폼별 외곽은 Apple 도구로 생성한다.

## 원본과 플랫폼별 산출물

- `src-tauri/icons/Garam.icon`: Icon Composer 원본. `Assets/river.png`는 승인된 시안에서 배경을 분리한 이미지이며, `icon.json`이 배경색·배치·재질을 지정한다.
- `src-tauri/icons/Assets.car`: Xcode의 `actool`로 컴파일한 macOS 시스템 아이콘. `tauri.macos.conf.json`에서만 포함한다.
- `src-tauri/icons/icon.icns`: 구형 macOS용 다중 해상도 대체 아이콘.
- `src-tauri/icons/icon.ico`: Windows용 다중 해상도 아이콘.
- `src-tauri/icons/*x*.png`: Linux 및 공통 런타임용 아이콘.
- `src-tauri/icons/icon.png`: 1024×1024 미리보기 및 래스터 마스터.

macOS의 새 아이콘에는 배경 타일 이미지를 넣지 않는다. 투명 심볼과 배경색을 따로 제공하고 시스템이 모서리와 외곽을 그린다. 따라서 이미 둥근 사각형인 이미지를 다시 시스템 사각형 안에 넣는 중복 구성을 피한다. Tauri가 `Assets.car`에서 `CFBundleIconName`을 추출하고 ICNS를 별도 fallback으로 등록한다.

래스터 마스터는 Icon Composer의 824px 타일에 100px 투명 여백을 두어 1024px로 만든다. `.icon` 자체에는 이 외부 여백을 넣지 않는다. 심볼에 이미 얕은 반사 표현이 있으므로 추가 glass/specular 효과를 끈다.

## 재생성

macOS, Xcode 27 이상, Swift, pnpm 및 설치된 프로젝트 의존성이 필요하다.

```sh
bash scripts/build-icons.sh
```

생성된 자산을 저장소에 함께 보관하므로 일반 Windows/Linux 빌드에 Xcode는 필요하지 않다. 현재 스크립트는 Icon Composer 27 CLI 형식과 디자인 세대를 사용한다.

## 확인

```sh
pnpm tauri build --bundles app
plutil -p target/release/bundle/macos/Garam.app/Contents/Info.plist
assetutil --info target/release/bundle/macos/Garam.app/Contents/Resources/Assets.car
```

`CFBundleIconName = Garam`, `CFBundleIconFile = icon.icns`, `Resources/Assets.car` 포함 여부를 확인한다. Finder에 기존 앱 아이콘 캐시가 남을 수 있으므로 개발 실행 창만으로 판단하지 말고 새로 빌드한 앱 번들을 확인한다. 실제 Windows/Linux 설치 및 모든 macOS 외관 모드는 각 운영체제에서 별도 검증해야 한다.

참고: [Apple Icon Composer](https://developer.apple.com/icon-composer/), [Tauri macOS 아이콘 처리](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/icon.rs).
