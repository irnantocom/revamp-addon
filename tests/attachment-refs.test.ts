import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_DATA_URL_CHARS, resolveAttachmentSources } from '../src/utils/attachment-refs';
import type { StoredAttachment } from '../src/types/attachments';
import type { Operation } from '../src/types/operations';

const image = (id: string, data = 'QUJD'): StoredAttachment => ({
  meta: { id, name: `${id}.png`, kind: 'image', mime: 'image/png', size: 3 },
  parts: [{ type: 'image', mime: 'image/png', data }],
  bytes: data.length,
});
const pdf: StoredAttachment = {
  meta: { id: 'doc', name: 'a.pdf', kind: 'pdf', mime: 'application/pdf', size: 1 },
  parts: [{ type: 'pdf', name: 'a.pdf', data: 'P' }],
  bytes: 1,
};
const store = (...files: StoredAttachment[]) => async (id: string) => files.find((f) => f.meta.id === id);
const replace = (id: string, src: string): Operation => ({ id, op: 'replace_image', target: 5, explanation: '', src });

describe('resolveAttachmentSources', () => {
  it('swaps an attachment reference for the stored image as a data URL', async () => {
    const { operations, errors } = await resolveAttachmentSources([replace('a', 'attachment:img1')], store(image('img1')));

    expect(errors).toEqual([]);
    expect(operations).toEqual([{ ...replace('a', ''), src: 'data:image/png;base64,QUJD' }]);
  });

  describe('set_style backgrounds', () => {
    const style = (styles: Record<string, string>): Operation => ({ id: 's', op: 'set_style', target: 5, explanation: '', styles });

    it('resolves url(attachment:<id>) in background-image, keeping gradient layers and !important', async () => {
      const { operations, errors } = await resolveAttachmentSources(
        [style({ 'background-image': 'linear-gradient(red, blue), url(attachment:img1) !important', color: 'red' })],
        store(image('img1'))
      );

      expect(errors).toEqual([]);
      expect(operations[0]).toMatchObject({
        styles: { 'background-image': 'linear-gradient(red, blue), url("data:image/png;base64,QUJD") !important', color: 'red' },
      });
    });

    it('accepts quoted references, the background shorthand and camelCase names', async () => {
      const { operations } = await resolveAttachmentSources(
        [style({ background: "url('attachment:img1') center / cover", backgroundImage: 'url("attachment:img1")' })],
        store(image('img1'))
      );

      expect(operations[0]).toMatchObject({
        styles: {
          background: 'url("data:image/png;base64,QUJD") center / cover',
          backgroundImage: 'url("data:image/png;base64,QUJD")',
        },
      });
    });

    it('drops the whole operation when its image cannot be used', async () => {
      const { operations, errors } = await resolveAttachmentSources(
        [style({ 'background-image': 'url(attachment:gone)', color: 'red' }), style({ color: 'blue' })],
        store()
      );

      expect(operations).toHaveLength(1);
      expect(errors).toEqual([{ operationId: 's', error: expect.stringContaining('no longer available') }]);
    });

    it('does not touch references in other properties', async () => {
      const ops = [style({ 'list-style-image': 'url(attachment:img1)' })];

      const { operations, errors } = await resolveAttachmentSources(ops, store(image('img1')));

      expect(errors).toEqual([]);
      expect(operations).toEqual(ops);
    });
  });

  it('leaves URLs and other operations alone', async () => {
    const ops: Operation[] = [replace('a', 'https://x.test/a.webp'), { id: 'b', op: 'remove', target: 2, explanation: '' }];

    const result = await resolveAttachmentSources(ops, store());

    expect(result).toEqual({ operations: ops, errors: [] });
  });

  it('reports an image that is gone from storage and drops only that operation', async () => {
    const { operations, errors } = await resolveAttachmentSources(
      [replace('a', 'attachment:missing'), replace('b', 'https://x.test/b.png')],
      store()
    );

    expect(operations.map((o) => o.id)).toEqual(['b']);
    expect(errors).toEqual([{ operationId: 'a', error: expect.stringContaining('no longer available') }]);
  });

  it('refuses an attachment that is not an image', async () => {
    const { operations, errors } = await resolveAttachmentSources([replace('a', 'attachment:doc')], store(pdf));

    expect(operations).toEqual([]);
    expect(errors[0].error).toContain('not an image');
  });

  describe('shrinking', () => {
    it('uses the shrunk image, so a large upload that fits after shrinking is accepted', async () => {
      const big = image('big', 'A'.repeat(MAX_IMAGE_DATA_URL_CHARS));
      const shrink = async () => 'data:image/webp;base64,SMALL';

      const { operations, errors } = await resolveAttachmentSources([replace('a', 'attachment:big')], store(big), shrink);

      expect(errors).toEqual([]);
      expect(operations[0]).toMatchObject({ src: 'data:image/webp;base64,SMALL' });
    });

    it('keeps the original when shrinking fails', async () => {
      const shrink = async () => {
        throw new Error('cannot decode');
      };

      const { operations } = await resolveAttachmentSources([replace('a', 'attachment:img1')], store(image('img1')), shrink);

      expect(operations[0]).toMatchObject({ src: 'data:image/png;base64,QUJD' });
    });

    it('still refuses an image that is too large after shrinking', async () => {
      const shrink = async (url: string) => url;
      const { operations, errors } = await resolveAttachmentSources(
        [replace('a', 'attachment:big')],
        store(image('big', 'A'.repeat(MAX_IMAGE_DATA_URL_CHARS))),
        shrink
      );

      expect(operations).toEqual([]);
      expect(errors[0].error).toContain('too large');
    });
  });

  it('refuses an image too large to keep in the demo', async () => {
    const big = image('big', 'A'.repeat(MAX_IMAGE_DATA_URL_CHARS));

    const { operations, errors } = await resolveAttachmentSources([replace('a', 'attachment:big')], store(big));

    expect(operations).toEqual([]);
    expect(errors[0].error).toContain('too large');
  });

  it('treats a storage failure like a missing image', async () => {
    const { errors } = await resolveAttachmentSources([replace('a', 'attachment:x')], () => Promise.reject(new Error('idb')));

    expect(errors).toHaveLength(1);
  });
});
