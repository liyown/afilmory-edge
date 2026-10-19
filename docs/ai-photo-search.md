# AI 语义搜索与自动标签

Afilmory Edge 会在照片上传后异步调用 Workers AI，生成图像描述和关键词，并把描述向量写入 Vectorize。画廊顶部的搜索框用自然语言查询照片，例如「海边日落」「去年冬天的猫」。

## 依赖

- Workers AI binding：`AI`
- Vectorize binding：`VECTORIZE`
- Vectorize 索引：`afilmory-photo-embeddings`
  - 维度：`1024`
  - 距离：`cosine`
- 默认模型：
  - 视觉：`@cf/mistralai/mistral-small-3.1-24b-instruct`
  - 向量：`@cf/baai/bge-m3`

模型可以通过 Worker 变量覆盖：

```text
AI_VISION_MODEL
AI_EMBEDDING_MODEL
```

如果更换 embedding 模型，向量维度必须仍然是 1024，或者同步重建 Vectorize 索引。

## 创建索引

```bash
cf vectorize create afilmory-photo-embeddings \
  --index-config-dimensions 1024 \
  --index-config-metric cosine
```

仓库提供幂等脚本：

```bash
sh scripts/ensure-vectorize-index.sh
```

`cf deploy` 前需要索引已经存在，否则 Vectorize binding 无法解析。

## 工作方式

1. `upload-complete` 发布 manifest 后，通过 `executionCtx.waitUntil()` 异步索引，不阻塞上传响应。
2. 索引服务优先读取 600px 缩略图；没有缩略图时，原图小于 8 MiB 也可以使用。
3. Mistral Small 3.1 Vision 返回 caption + 8–12 个英文关键词。
4. `bge-m3` 对 `title + caption + tags + EXIF` 生成 1024 维向量，写入 Vectorize。
5. AI 标签并入 manifest 的 `tags`，和手动标签一起显示、筛选；手动修改标签不会清掉 AI 标签。
6. 小时级 cron 每次补索引最多 10 张缺失/失败/跳过的照片。
7. 删除照片时会同时删除 Vectorize 向量。

## 关闭 AI

设置 Worker 变量：

```text
AI_INDEX_ENABLED=false
```

关闭后：

- 上传、浏览、标签编辑不受影响；
- 不会调用 Workers AI/Vectorize；
- 搜索接口返回 `enabled: false`，前端自动降级为标题/标签/EXIF 的文字匹配。

本地开发不想产生 AI 调用时，可以在 `apps/edge/.dev.vars` 中加入：

```text
AI_INDEX_ENABLED=false
```

## 成本

默认模型下，一次性索引 100–1000 张的估算：

| 图片数量 | 视觉 + 向量成本 |
| --- | --- |
| 100 张 | 约 $0.05–$0.2 |
| 500 张 | 约 $0.3–$1 |
| 1000 张 | 约 $0.6–$2 |

- Mistral Small 3.1 Vision：$0.351 / M input tokens，$0.555 / M output tokens
- BGE-M3：$0.012 / M input tokens
- Vectorize：1000 张 × 1024 维 = 1.024M stored dimensions，低于免费额度 5M
- Workers AI 每天有 10,000 neurons 免费额度，约等于每天 70–180 张图

搜索查询只嵌入几十个 token，成本可以忽略。

## 数据与索引状态

D1 表 `photo_ai_index` 记录每张照片的索引状态：

- `pending`：等待索引
- `processing`：已抢占，带 10 分钟 lease
- `ready`：已完成
- `failed`：失败，按退避时间重试
- `skipped`：缩略图/原图暂不可用，6 小时后重试

排障时可以查看该表的 `last_error` 和 `next_attempt_at`。
