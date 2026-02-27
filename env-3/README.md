Hand Grid Controller（Holistic 版）

- MediaPipe Holistic Landmarker で手＋全身ポーズを検出。
- env-2 と同じグリッド操作・ジェスチャー（グー/パー）に加え、getPoseLandmarks() で全身骨格を取得可能。

起動:
  cd env-3
  python -m http.server 8080
  http://localhost:8080
