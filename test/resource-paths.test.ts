import { describe, expect, it } from 'vitest';
import { resourceAssetUrl, rewriteResourceBody } from '../src/resource/resource-paths';

const options = { coreBaseUrl: 'https://core.test', proxyBase: '/api/resource/' };

describe('resourceAssetUrl', () => {
    it('a website file path becomes the satellite proxy route', () => {
        expect(resourceAssetUrl('/api/website/resource/7/file/31', options)).toBe('/api/resource/7/file/31');
        expect(resourceAssetUrl('/api/website/resource/7/file/31', { ...options, proxyBase: '/api/resource' })).toBe('/api/resource/7/file/31');
    });

    it('a public media path becomes core absolute url', () => {
        expect(resourceAssetUrl('/api/public/media/resource/7/guide.pdf', { ...options, coreBaseUrl: 'https://core.test/' })).toBe(
            'https://core.test/api/public/media/resource/7/guide.pdf'
        );
    });

    it('any other path is refused', () => {
        for (const path of [
            '/api/images/media/resource/7/a.png',
            'https://evil.test/x.png',
            '/api/website/resource/7/file/abc',
            '/api/public/media/product/1/a.png',
            '//evil.test/x',
            '/api/public/media/resource/7/a.png\n',
            '/api/public/media/resource/7/..',
        ]) {
            expect(resourceAssetUrl(path, options), path).toBeNull();
        }
    });
});

describe('rewriteResourceBody', () => {
    it('rewrites every image source', () => {
        const html =
            '<p>one</p><img src="/api/website/resource/7/file/31" alt="a b" class="x"><p>two</p>' +
            '<img alt="c" src="/api/public/media/resource/7/pic.png">';
        expect(rewriteResourceBody(html, options)).toBe(
            '<p>one</p><img src="/api/resource/7/file/31" alt="a b" class="x"><p>two</p>' +
                '<img alt="c" src="https://core.test/api/public/media/resource/7/pic.png">'
        );
    });

    it('drops an image with a source it does not know', () => {
        expect(rewriteResourceBody('<p>a<img src="/api/images/media/resource/7/x.png" alt="x">b</p>', options)).toBe('<p>ab</p>');
    });

    it('keeps an escaped angle bracket in an attribute untouched', () => {
        expect(rewriteResourceBody('<img alt="a&gt;b" src="/api/website/resource/7/file/31">', options)).toBe(
            '<img alt="a&gt;b" src="/api/resource/7/file/31">'
        );
    });

    it('leaves a body without images unchanged', () => {
        const html = '<h2>Title</h2><p>text &amp; more</p>';
        expect(rewriteResourceBody(html, options)).toBe(html);
    });
});
