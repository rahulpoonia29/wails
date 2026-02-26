//go:build linux && cgo && !gtk4 && !android && !server

package application

/*
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

extern void cookieRequestCallbackCGo(unsigned int requestID, char **names, char **values, char **domains, char **paths, double *expires, bool *httpOnly, bool *secure, int count);

typedef struct CookieResult {
    char **names;
    char **values;
    char **domains;
    char **paths;
    double *expires;
    bool *httpOnly;
    bool *secure;
    int count;
} CookieResult;

static void free_cookie_result(CookieResult *result) {
    if (result == NULL) {
        return;
    }
    if (result->names != NULL) {
        for (int i = 0; i < result->count; i++) {
            g_free(result->names[i]);
        }
        g_free(result->names);
    }
    if (result->values != NULL) {
        for (int i = 0; i < result->count; i++) {
            g_free(result->values[i]);
        }
        g_free(result->values);
    }
    if (result->domains != NULL) {
        for (int i = 0; i < result->count; i++) {
            g_free(result->domains[i]);
        }
        g_free(result->domains);
    }
    if (result->paths != NULL) {
        for (int i = 0; i < result->count; i++) {
            g_free(result->paths[i]);
        }
        g_free(result->paths);
    }
    if (result->expires != NULL) {
        g_free(result->expires);
    }
    if (result->httpOnly != NULL) {
        g_free(result->httpOnly);
    }
    if (result->secure != NULL) {
        g_free(result->secure);
    }
    g_free(result);
}

static void cookie_manager_get_cookies_finish(GObject *source, GAsyncResult *res, gpointer user_data) {
    unsigned int requestID = GPOINTER_TO_UINT(user_data);
    WebKitCookieManager *manager = WEBKIT_COOKIE_MANAGER(source);
    GError *error = NULL;

    GList *cookies = webkit_cookie_manager_get_cookies_finish(manager, res, &error);
    if (error != NULL) {
        g_error_free(error);
        cookieRequestCallbackCGo(requestID, NULL, NULL, NULL, NULL, NULL, NULL, NULL, -1);
        return;
    }

    int count = 0;
    for (GList *it = cookies; it != NULL; it = it->next) {
        count++;
    }

    CookieResult *result = g_new0(CookieResult, 1);
    result->count = count;
    if (count == 0) {
        cookieRequestCallbackCGo(requestID, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0);
        g_list_free_full(cookies, (GDestroyNotify)soup_cookie_free);
        g_free(result);
        return;
    }

    result->names = g_new0(char*, count);
    result->values = g_new0(char*, count);
    result->domains = g_new0(char*, count);
    result->paths = g_new0(char*, count);
    result->expires = g_new0(double, count);
    result->httpOnly = g_new0(bool, count);
    result->secure = g_new0(bool, count);

    int idx = 0;
    for (GList *it = cookies; it != NULL; it = it->next) {
        SoupCookie *cookie = (SoupCookie*)it->data;
        const char *name = soup_cookie_get_name(cookie);
        const char *value = soup_cookie_get_value(cookie);
        const char *domain = soup_cookie_get_domain(cookie);
        const char *path = soup_cookie_get_path(cookie);
        GDateTime *expires = soup_cookie_get_expires(cookie);

        result->names[idx] = g_strdup(name ? name : "");
        result->values[idx] = g_strdup(value ? value : "");
        result->domains[idx] = g_strdup(domain ? domain : "");
        result->paths[idx] = g_strdup(path ? path : "");
        result->httpOnly[idx] = soup_cookie_get_http_only(cookie);
        result->secure[idx] = soup_cookie_get_secure(cookie);
        if (expires != NULL) {
            result->expires[idx] = (double)g_date_time_to_unix(expires);
        } else {
            result->expires[idx] = -1.0;
        }
        idx++;
    }

    cookieRequestCallbackCGo(requestID, result->names, result->values, result->domains, result->paths,
                             result->expires, result->httpOnly, result->secure, result->count);

    free_cookie_result(result);
    g_list_free_full(cookies, (GDestroyNotify)soup_cookie_free);
}

static void window_cookie_request(void *webview, unsigned int requestID, const char *url) {
    WebKitWebView *view = WEBKIT_WEB_VIEW(webview);
    WebKitWebContext *context = webkit_web_view_get_context(view);
    if (context == NULL) {
        cookieRequestCallbackCGo(requestID, NULL, NULL, NULL, NULL, NULL, NULL, NULL, -1);
        return;
    }
    WebKitCookieManager *manager = webkit_web_context_get_cookie_manager(context);
    if (manager == NULL) {
        cookieRequestCallbackCGo(requestID, NULL, NULL, NULL, NULL, NULL, NULL, NULL, -1);
        return;
    }

    const gchar *uri = NULL;
    if (url != NULL && url[0] != '\0') {
        uri = url;
    }
    webkit_cookie_manager_get_cookies(manager, uri, NULL, cookie_manager_get_cookies_finish, GUINT_TO_POINTER(requestID));
}
*/
import "C"

import (
	"net/http"
	"sync"
	"time"
	"unsafe"
)

type linuxCookieResult struct {
	cookies []*http.Cookie
}

var linuxCookieRequests = struct {
	mu     sync.Mutex
	nextID uint
	store  map[uint]chan linuxCookieResult
}{
	store: map[uint]chan linuxCookieResult{},
}

func newLinuxCookieRequest() (uint, chan linuxCookieResult) {
	linuxCookieRequests.mu.Lock()
	defer linuxCookieRequests.mu.Unlock()
	linuxCookieRequests.nextID++
	id := linuxCookieRequests.nextID
	ch := make(chan linuxCookieResult, 1)
	linuxCookieRequests.store[id] = ch
	return id, ch
}

func removeLinuxCookieRequest(id uint) {
	linuxCookieRequests.mu.Lock()
	defer linuxCookieRequests.mu.Unlock()
	delete(linuxCookieRequests.store, id)
}

func fetchLinuxCookieChannel(id uint) (chan linuxCookieResult, bool) {
	linuxCookieRequests.mu.Lock()
	defer linuxCookieRequests.mu.Unlock()
	ch, ok := linuxCookieRequests.store[id]
	return ch, ok
}

//export cookieRequestCallbackCGo
func cookieRequestCallbackCGo(requestID C.uint, names **C.char, values **C.char, domains **C.char, paths **C.char, expires *C.double, httpOnly *C.bool, secure *C.bool, count C.int) {
	ch, ok := fetchLinuxCookieChannel(uint(requestID))
	if !ok {
		return
	}

	length := int(count)
	if length < 0 {
		ch <- linuxCookieResult{cookies: nil}
		return
	}
	if length == 0 {
		ch <- linuxCookieResult{cookies: []*http.Cookie{}}
		return
	}
	if names == nil || values == nil || domains == nil || paths == nil || expires == nil || httpOnly == nil || secure == nil {
		ch <- linuxCookieResult{cookies: nil}
		return
	}

	nameSlice := (*[1 << 30]*C.char)(unsafe.Pointer(names))[:length:length]
	valueSlice := (*[1 << 30]*C.char)(unsafe.Pointer(values))[:length:length]
	domainSlice := (*[1 << 30]*C.char)(unsafe.Pointer(domains))[:length:length]
	pathSlice := (*[1 << 30]*C.char)(unsafe.Pointer(paths))[:length:length]
	expiresSlice := (*[1 << 30]C.double)(unsafe.Pointer(expires))[:length:length]
	httpOnlySlice := (*[1 << 30]C.bool)(unsafe.Pointer(httpOnly))[:length:length]
	secureSlice := (*[1 << 30]C.bool)(unsafe.Pointer(secure))[:length:length]

	cookies := make([]*http.Cookie, 0, length)
	for i := 0; i < length; i++ {
		cookie := &http.Cookie{
			Name:     C.GoString(nameSlice[i]),
			Value:    C.GoString(valueSlice[i]),
			Domain:   C.GoString(domainSlice[i]),
			Path:     C.GoString(pathSlice[i]),
			HttpOnly: httpOnlySlice[i] != 0,
			Secure:   secureSlice[i] != 0,
		}
		if exp := float64(expiresSlice[i]); exp >= 0 {
			cookie.Expires = time.Unix(int64(exp), 0)
		}
		cookies = append(cookies, cookie)
	}

	ch <- linuxCookieResult{cookies: cookies}
}

func linuxGetCookies(w *linuxWebviewWindow, targetURL string) []*http.Cookie {
	if w == nil || w.webview == nil || w.parent == nil || w.parent.isDestroyed() {
		return nil
	}

	requestID, ch := newLinuxCookieRequest()
	globalApplication.dispatchOnMainThread(func() {
		cURL := C.CString(targetURL)
		C.window_cookie_request(unsafe.Pointer(w.webview), C.uint(requestID), cURL)
		C.free(unsafe.Pointer(cURL))
	})

	result := <-ch
	removeLinuxCookieRequest(requestID)
	return result.cookies
}
