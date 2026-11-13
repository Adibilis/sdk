import { shopImageUrl } from '../shop/product-image.js';

const WEBSITE_FILE_PATH = /^\/api\/website\/resource\/(\d+)\/file\/(\d+)$/;
const PUBLIC_MEDIA_PATH = /^\/api\/public\/media\/resource\/\d+\/[^/?#]+$/;
const IMG_TAG = /<img\b[^>]*>/gi;
const IMG_SRC = /(\ssrc=")([^"]*)(")/i;

/** Where a satellite serves resource paths: core's address for public media, its own route for protected files. */
export interface ResourceAssetOptions {
    /** Core's base URL, used for public media, which a browser loads from core without a key. */
    coreBaseUrl: string;
    /** The satellite's route that proxies `resourceFile`, e.g. `/api/resource`; a trailing slash is ignored. */
    proxyBase: string;
}

/**
 * The URL a browser should load for a path core wrote into a resource: a protected file
 * (`/api/website/resource/{id}/file/{mediaId}`) becomes the satellite's proxy route, a public media
 * path (`/api/public/media/resource/{id}/{file}`) becomes core's absolute URL. Any other path answers
 * `null`, so a satellite never renders a URL core did not mean.
 *
 * Browser-safe on purpose: compose it wherever the base URLs are known — on the server, then hand
 * the result to the page as a prop, so the base URL is never inlined into a bundle.
 */
export function resourceAssetUrl(path: string, options: ResourceAssetOptions): string | null {
    const file = WEBSITE_FILE_PATH.exec(path);
    if (file) return `${options.proxyBase.replace(/\/+$/, '')}/${file[1]}/file/${file[2]}`;
    if (PUBLIC_MEDIA_PATH.test(path)) return shopImageUrl(options.coreBaseUrl, path);
    return null;
}

/**
 * An article body with every `<img src>` resolved through {@link resourceAssetUrl}; an image whose
 * source is not one of core's two shapes is dropped. Core serializes bodies with double-quoted
 * attributes and restricts file names, so a source never holds a quote, a space or `&`.
 *
 * Browser-safe on purpose: run it on the server and pass the result to the page as a prop.
 */
export function rewriteResourceBody(html: string, options: ResourceAssetOptions): string {
    return html.replace(IMG_TAG, (tag) => {
        const src = IMG_SRC.exec(tag);
        const url = src ? resourceAssetUrl(src[2]!, options) : null;
        if (url === null) return '';
        return tag.replace(IMG_SRC, (_all, open: string, _old: string, close: string) => `${open}${url}${close}`);
    });
}
