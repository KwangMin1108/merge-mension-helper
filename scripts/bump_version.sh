#!/bin/bash
# bump_version.sh — index.html 버전 자동 증가
# 형식: vYYMMDD.N  (예: v260503.1)
# 사용법: bash scripts/bump_version.sh

INDEX="$(dirname "$0")/../index.html"
TODAY=$(date +%y%m%d)

# 현재 버전 추출
CURRENT=$(grep -o 'v[0-9]\{6\}\.[0-9]\+' "$INDEX" | head -1)

if [ -z "$CURRENT" ]; then
  NEW="v${TODAY}.1"
else
  CUR_DATE="${CURRENT:1:6}"
  CUR_N="${CURRENT##*.}"
  if [ "$CUR_DATE" = "$TODAY" ]; then
    NEW="v${TODAY}.$((CUR_N + 1))"
  else
    NEW="v${TODAY}.1"
  fi
fi

sed -i '' "s/${CURRENT}/${NEW}/g" "$INDEX"
echo "버전 업데이트: ${CURRENT:-없음} → ${NEW}"
