---
mode: agent
---

# 图像转换策略指引

## 📋 添加新图像转换策略的步骤

当需要支持新的图像格式时，请按以下模板创建转换策略：

### 1. 策略类模板

```text
export class [FormatName]ConverterStrategy implements ImageConverterStrategy {
  getName(): string {
    return '[Format Display Name]'
  }

  getSupportedFormats(): string[] {
    return ['image/[format]'] // 如：['image/jxl', 'image/jpeg-xl']
  }

  async shouldConvert(blob: Blob): Promise<boolean> {
    // 检查浏览器是否原生支持该格式
    if (this.isBrowserSupport[Format]()) {
      return false
    }

    // 检测是否为目标格式
    return blob.type === 'image/[format]' || await this.detect[Format]Format(blob)
  }

  async convert(blob: Blob, originalUrl: string, callbacks?: LoadingCallbacks): Promise<ConversionResult> {
    const { onLoadingStateUpdate } = callbacks || {}

    try {
      // 更新转换状态
      onLoadingStateUpdate?.({
        isConverting: true,
        conversionMessage: 'Converting [Format] image...',
      })

      // 执行转换逻辑
      const result = await this.convert[Format]ToJpeg(blob)

      return {
        url: result.url,
        convertedSize: result.size,
        format: 'image/jpeg',
        originalSize: blob.size,
      }
    } catch (error) {
      console.error('[Format] conversion failed:', error)
      throw new Error(`[Format] conversion failed: ${error}`)
    }
  }

  // 浏览器支持检测
  private isBrowserSupport[Format](): boolean {
    // 实现浏览器支持检测逻辑
  }

  // 格式检测
  private async detect[Format]Format(blob: Blob): Promise<boolean> {
    // 实现文件头魔数检测
  }

  // 转换实现
  private async convert[Format]ToJpeg(blob: Blob): Promise<{ url: string; size: number }> {
    // 实现具体转换逻辑
  }
}
```

### 2. 注册策略

```text
// 在 image-converter-strategies.ts 的构造函数中添加
imageConverterManager.registerStrategy(new [FormatName]ConverterStrategy())
```

### 3. 必需实现的方法

- **格式检测**: 通过 MIME 类型和文件头魔数识别格式
- **浏览器支持检测**: 检查当前浏览器是否原生支持该格式
- **转换实现**: 将格式转换为浏览器支持的格式（通常是 JPEG）
- **错误处理**: 提供详细的错误信息和回退机制

### 4. 现有策略参考

```typescript
// HEIC 策略 - 使用第三方库
HeicConverterStrategy // 文件: image-converter-strategies.ts

// WebP 策略 - 使用 Canvas API
WebpConverterStrategy // 文件: image-converter-strategies.ts

// AVIF 策略 - 预留接口
AvifConverterStrategy // 文件: image-converter-strategies.ts

// TIFF 策略 - 使用 tiff 库
TiffConverterStrategy // 文件: image-converter-strategies.ts
```

### 5. 常用检测模式

```typescript
// MIME 类型检测
blob.type === 'image/[format]'

// 文件头魔数检测
const arrayBuffer = await blob.slice(0, 12).arrayBuffer()
const uint8Array = new Uint8Array(arrayBuffer)
// 检查特定字节序列

// 浏览器支持检测
const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
return canvas.toDataURL('image/[format]').indexOf('data:image/[format]') === 0
```

### 6. 错误处理模式

```typescript
try {
  // 转换逻辑
} catch (error) {
  console.error('[Format] conversion failed:', error)
  throw new Error(`[Format] conversion failed: ${error}`)
}
```

### 7. 性能优化建议

- 使用动态 import 延迟加载转换库
- 实现 LRU 缓存机制
- 提供转换进度回调
- 使用 Web Workers (如果转换耗时较长)
