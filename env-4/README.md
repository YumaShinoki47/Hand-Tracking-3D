Hand Grid Controller（env-4・手のみ版）

- MediaPipe **Hand Landmarker** のみで手を検出（全身ポーズなし）。`env-3`（Holistic）より軽量な構成で負荷検証用。
- グリッド操作・ジェスチャー（グー/パー）・実験プロトコル・コンタミ表示は `env-3` とほぼ同じ。コンタミ加算は手のひら中心のみ（ポーズ手首による加算はなし）。

起動:

  cd env-4
  python -m http.server 8080
  http://localhost:8080
