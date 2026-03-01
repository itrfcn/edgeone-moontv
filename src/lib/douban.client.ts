import { DoubanItem, DoubanResult } from './types';
import { getDoubanProxyUrl } from './utils';

interface DoubanCategoriesParams {
  kind: 'tv' | 'movie' | 'show';
  category: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

/**
 * 带超时的 fetch 请求
 */
const FALLBACK_CORS_PROXIES = [
  'https://cors.isteed.cc/',
  'https://cors.isteed.cc/https://',
];

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  // 检查是否使用代理
  const proxyUrl = getDoubanProxyUrl();
  // 正确处理代理URL，避免对整个URL编码
  const finalUrl = proxyUrl ? 
    (proxyUrl.endsWith('https://') ? `${proxyUrl}${url.replace(/^https?:\/\//, '')}` : `${proxyUrl}${url}`) 
    : url;

  const fetchOptions: RequestInit = {
    ...options,
    signal: controller.signal,
    headers: {
      // 浏览器受限请求头不强行设置，仅保留可允许的 Accept
      Accept: 'application/json, text/plain, */*',
      ...options.headers,
    },
  };

  try {
    let response = await fetch(finalUrl, fetchOptions);
    clearTimeout(timeoutId);

    // 如果被 CORS 限制（opaque 或非 2xx），并且未设置自有代理，则尝试公共 CORS 代理作为兜底
    if ((response.type === 'opaque' || !response.ok) && !proxyUrl) {
      for (const px of FALLBACK_CORS_PROXIES) {
        try {
          const resp = await fetch(
            px.endsWith('https://') ? `${px}${url.replace(/^https?:\/\//, '')}` : `${px}${url}`,
            fetchOptions
          );
          if (resp.ok && resp.type !== 'opaque') {
            response = resp;
            break;
          }
        } catch (_) {
          // 继续尝试下一个
        }
      }
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    // fetch 直接抛错（如被 CORS 拦截或网络失败）时，尝试公共代理兜底
    if (!proxyUrl) {
      for (const px of FALLBACK_CORS_PROXIES) {
        try {
          const resp = await fetch(
            px.endsWith('https://') ? `${px}${url.replace(/^https?:\/\//, '')}` : `${px}${url}`,
            fetchOptions
          );
          if (resp.ok && resp.type !== 'opaque') {
            return resp;
          }
        } catch (_) {
          // 继续尝试下一个
        }
      }
    }
    throw error;
  }
}

/**
 * 检查是否应该使用客户端获取豆瓣数据
 */
export function shouldUseDoubanClient(): boolean {
  // 静态导出模式不提供服务端 API，统一使用客户端直连/代理
  return true;
}

/**
 * 浏览器端豆瓣分类数据获取函数
 */
export async function fetchDoubanCategories(
  params: DoubanCategoriesParams
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;

  // 验证参数
  if (!['tv', 'movie', 'show'].includes(kind)) {
    throw new Error('kind 参数必须是 tv、movie 或 show');
  }

  if (!category || !type) {
    throw new Error('category 和 type 参数不能为空');
  }

  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必须在 1-100 之间');
  }

  if (pageStart < 0) {
    throw new Error('pageStart 不能小于 0');
  }

  // 首先定义所有需要的变量
  let tag = '热门'; // 默认标签
  let apiType = kind;
  let finalTag = tag;
  
  // 根据不同类型处理
  if (kind === 'show') {
    // 综艺类型使用专门的API端点
    apiType = 'tv'; // 仍然使用tv类型API
    
    // 尝试使用豆瓣API支持的具体标签
    if (type === 'show') {
      finalTag = '综艺';
    } else if (type === 'show_domestic') {
      finalTag = '国产剧'; // 尝试使用国产剧标签，然后在客户端过滤
    } else if (type === 'show_foreign') {
      finalTag = '欧美剧'; // 尝试使用欧美剧标签，然后在客户端过滤
    } else if (type === 'show_korean') {
      finalTag = '韩剧'; // 尝试使用韩剧标签，然后在客户端过滤
    } else if (type === 'show_japanese') {
      finalTag = '日剧'; // 尝试使用日剧标签，然后在客户端过滤
    } else {
      finalTag = '综艺'; // 默认使用综艺标签
    }
  } else if (kind === 'movie') {
    // 电影类型处理
    // 恢复原始的标签组合逻辑，确保热门电影的地区筛选正常工作
    if (category === '热门') {
      // 热门电影直接使用地区作为标签
      tag = type === '全部' ? '热门' : type;
    } else if (type === '全部') {
      // 其他分类且地区为"全部"时，直接使用分类标签
      tag = category;
    } else {
      // 其他分类且选择了地区时，我们将在客户端进行过滤
      // 因为豆瓣API可能不支持这些组合
      tag = category;
    }
    
    finalTag = tag;
  } else if (kind === 'tv') {
    // 电视剧类型处理
    if (type === 'tv') {
      tag = '热门';
    } else if (type === 'tv_domestic') {
      tag = '国产剧';
    } else if (type === 'tv_american') {
      tag = '美剧';
    } else if (type === 'tv_english') {
      tag = '英剧';
    } else if (type === 'tv_japanese') {
      tag = '日剧';
    } else if (type === 'tv_korean') {
      tag = '韩剧';
    } else if (type === 'tv_animation' || type === 'animation') {
      tag = '动画'; // 尝试使用'动画'标签代替'动漫'
    } else if (type === 'tv_documentary') {
      tag = '纪录片';
    }
    finalTag = tag;
  }

  const target = `https://movie.douban.com/j/search_subjects?type=${apiType}&tag=${finalTag}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;

  try {
    const response = await fetchWithTimeout(target);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // 正确的API响应格式是 { subjects: [...] }
    const doubanData = await response.json();

    // 转换数据格式
    const list: DoubanItem[] = doubanData.subjects.map((item: any) => ({
      id: item.id,
      title: item.title,
      poster: item.cover || '',
      rate: item.rate || '',
      year: '', // 这个API没有提供年份信息
    }));

    return {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } catch (error) {
    // 触发全局错误提示
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('globalError', {
          detail: { message: '获取豆瓣分类数据失败' },
        })
      );
    }
    throw new Error(`获取豆瓣分类数据失败: ${(error as Error).message}`);
  }
}

/**
 * 统一的豆瓣分类数据获取函数，根据代理设置选择使用服务端 API 或客户端代理获取
 */
export async function getDoubanCategories(
  params: DoubanCategoriesParams
): Promise<DoubanResult> {
  // 统一走客户端直连/代理
  return fetchDoubanCategories(params);
}

interface DoubanListParams {
  tag: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

export async function getDoubanList(
  params: DoubanListParams
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;
  // 统一走客户端直连/代理
  return fetchDoubanList(params);
}

export async function fetchDoubanList(
  params: DoubanListParams
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;

  // 验证参数
  if (!tag || !type) {
    throw new Error('tag 和 type 参数不能为空');
  }

  if (!['tv', 'movie', 'show'].includes(type)) {
    throw new Error('type 参数必须是 tv、movie 或 show');
  }

  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必须在 1-100 之间');
  }

  if (pageStart < 0) {
    throw new Error('pageStart 不能小于 0');
  }

  // 首先定义所有需要的变量
  let apiType = type;
  let finalTag = tag;
  
  // 设置正确的apiType，确保只使用豆瓣API支持的类型
  if (type.startsWith('tv_')) {
    apiType = 'tv'; // tv_animation、tv_documentary等都使用tv类型API
  } else if (type === 'show') {
    apiType = 'tv'; // 综艺类型也使用tv类型API
  } else if (type === 'animation') {
    apiType = 'movie'; // 动漫类型使用movie类型API获取数据
  }
  
  // 根据不同类型处理
  if (type === 'show') {
    // 综艺类型使用专门的API端点
    
    // 尝试使用豆瓣API支持的具体标签
    if (tag === 'show') {
      finalTag = '综艺';
    } else if (tag === 'show_domestic') {
      finalTag = '国产剧'; // 尝试使用国产剧标签
    } else if (tag === 'show_foreign') {
      finalTag = '欧美剧'; // 尝试使用欧美剧标签
    } else if (tag === 'show_korean') {
      finalTag = '韩剧'; // 尝试使用韩剧标签
    } else if (tag === 'show_japanese') {
      finalTag = '日剧'; // 尝试使用日剧标签
    } else {
      finalTag = '综艺'; // 默认使用综艺标签
    }
  } else if (type === 'movie') {
    // 电影类型直接使用传入的tag
    finalTag = tag;
  } else if (type === 'animation') {
    // 独立动漫分类
    finalTag = '动画'; // 使用'动画'标签
  } else {
    // 电视剧类型处理
    if (tag === 'tv') {
      finalTag = '热门';
    } else if (tag === 'tv_domestic') {
      finalTag = '国产剧';
    } else if (tag === 'tv_american') {
      finalTag = '美剧';
    } else if (tag === 'tv_english') {
      finalTag = '英剧';
    } else if (tag === 'tv_japanese') {
      finalTag = '日剧';
    } else if (tag === 'tv_korean') {
      finalTag = '韩剧';
    } else if (tag === 'tv_animation') {
      finalTag = '动画'; // 尝试使用'动画'标签代替'动漫'
    } else if (tag === 'tv_documentary') {
      finalTag = '纪录片';
    } else {
      finalTag = tag;
    }
  }

  const target = `https://movie.douban.com/j/search_subjects?type=${apiType}&tag=${finalTag}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;

  try {
    const response = await fetchWithTimeout(target);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // 正确的API响应格式是 { subjects: [...] }
    const doubanData = await response.json();

    // 转换数据格式
    const list: DoubanItem[] = doubanData.subjects.map((item: any) => ({
      id: item.id,
      title: item.title,
      poster: item.cover || '',
      rate: item.rate || '',
      year: '', // 这个API没有提供年份信息
    }));

    return {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } catch (error) {
    // 触发全局错误提示
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('globalError', {
          detail: { message: '获取豆瓣列表数据失败' },
        })
      );
    }
    throw new Error(`获取豆瓣分类数据失败: ${(error as Error).message}`);
  }
}
