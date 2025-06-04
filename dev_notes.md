
```bash
# 一行跑完弱性能构建
NODE_OPTIONS="--max-old-space-size=512" \
GENERATE_SOURCEMAP=false DISABLE_ESLINT_PLUGIN=true \
nice -n19 ionice -c3 npm run build
```