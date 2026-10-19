import { BizException, ErrorCode } from '@core/errors'
import { describe, expect, it } from 'vitest'

import { describeStreamError } from './sse-error'

describe('describeStreamError', () => {
  it('forwards the code and details of a business exception', () => {
    const error = new BizException(ErrorCode.PHOTO_MANIFEST_GENERATION_FAILED, {
      message: '清单生成失败',
      details: { reason: 'storage', capacityBytes: 100 },
    })

    expect(describeStreamError(error)).toEqual({
      message: '清单生成失败',
      code: ErrorCode.PHOTO_MANIFEST_GENERATION_FAILED,
      details: { reason: 'storage', capacityBytes: 100 },
    })
  })

  it('reduces an unknown failure to its message', () => {
    expect(describeStreamError(new Error('boom'))).toEqual({ message: 'boom' })
    expect(describeStreamError('nope')).toEqual({ message: '上传失败' })
  })
})
