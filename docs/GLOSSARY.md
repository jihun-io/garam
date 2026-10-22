# Git 용어 번역표 (한국어)

UI 문자열을 번역할 때 이 표를 따른다. 새 용어가 생기면 먼저 여기에 추가한다.

## 원칙

- 개발자 사이에서 굳어진 외래어(커밋, 브랜치, 푸시 등)는 음역을 쓴다. 억지로 순화하면 오히려 문서·검색과 연결이 끊긴다.
- 동작을 설명하는 문장은 쉬운 우리말로 쓴다. 예: "스테이지에 올리기"보다 "커밋에 포함".
- 버튼은 동사로 끝낸다. 예: "커밋", "푸시", "변경 취소".
- 같은 동작은 화면 어디서나 같은 이름을 쓴다. 버튼이 "푸시"면 완료 알림도 "푸시했습니다"다.
- 높임은 "-합니다/-하세요" 체로 통일한다.

## 용어

| 영어                             | 한국어                 | 비고                                  |
| -------------------------------- | ---------------------- | ------------------------------------- |
| repository                       | 저장소                 | "리포지토리"는 쓰지 않는다            |
| clone                            | 복제                   | 명령 이름을 설명할 때만 "클론"을 병기 |
| commit (명사·동사)               | 커밋                   |                                       |
| amend                            | 마지막 커밋 수정       |                                       |
| branch                           | 브랜치                 |                                       |
| checkout / switch                | 전환                   | "브랜치 전환"                         |
| merge                            | 병합                   |                                       |
| rebase                           | 리베이스               |                                       |
| cherry-pick                      | 체리픽                 |                                       |
| revert                           | 커밋 되돌리기          | reset과 구분할 것                     |
| reset                            | 리셋                   |                                       |
| stash                            | 스태시                 | 설명: "변경 사항 임시 보관"           |
| stage                            | 커밋에 포함 / 스테이지 | 체크박스 동작은 "커밋에 포함"         |
| unstage                          | 커밋에서 제외          |                                       |
| staged changes                   | 스테이지된 변경 사항   |                                       |
| working tree / working directory | 작업 폴더              |                                       |
| discard changes                  | 변경 취소              | 되돌릴 수 없음을 경고할 것            |
| changes                          | 변경 사항              |                                       |
| diff                             | 차이 / diff            | 화면 제목은 "변경 내용"               |
| hunk                             | 변경 묶음              |                                       |
| history / log                    | 기록                   | "내역"은 쓰지 않는다(명세서 느낌)     |
| remote                           | 원격 저장소            |                                       |
| origin                           | origin                 | 이름이므로 번역하지 않음              |
| upstream                         | 업스트림               |                                       |
| fetch                            | 가져오기(fetch)        | 버튼: "Fetch" 대신 "가져오기"         |
| pull                             | 풀                     | 설명: "원격 변경 사항 받아오기"       |
| push                             | 푸시                   |                                       |
| publish branch                   | 브랜치 게시            |                                       |
| force push                       | 강제 푸시              |                                       |
| ahead / behind                   | 보낼 커밋 / 받을 커밋  | 예: "↑2 보낼 커밋"                    |
| conflict                         | 충돌                   |                                       |
| resolve                          | 해결                   |                                       |
| ours / theirs                    | 내 변경 / 상대 변경    |                                       |
| tag                              | 태그                   |                                       |
| submodule                        | 서브모듈               |                                       |
| worktree                         | 워크트리               |                                       |
| HEAD                             | HEAD                   | 번역하지 않음                         |
| detached HEAD                    | 분리된 HEAD            |                                       |
| hash / SHA                       | 해시                   |                                       |
| author                           | 작성자                 |                                       |
| co-author                        | 공동 작성자            |                                       |
| credential                       | 자격 증명              |                                       |
| credential helper                | 자격 증명 도우미       |                                       |
| personal access token            | 개인 액세스 토큰       |                                       |
| passphrase (SSH key)             | 암호                   | "패스프레이즈"는 쓰지 않는다          |
| host key fingerprint             | 지문                   |                                       |
| fast-forward                     | 빨리 감기              |                                       |
