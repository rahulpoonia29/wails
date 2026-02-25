const fs = require('fs');

let file = fs.readFileSync('v3/pkg/application/webview_window_windows.go', 'utf8');

file = file.replace(`import (
	"errors"
	"fmt"
	"net/url"`, `import (
	"errors"
	"fmt"
	"net/http"
	"net/url"`);

file = file.replace(`func (w *windowsWebviewWindow) execJS(js string) {`, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	var cookies []*http.Cookie
	var wg sync.WaitGroup
	wg.Add(1)

	globalApplication.dispatchOnMainThread(func() {
		defer wg.Done()
		cm, err := w.chromium.GetCookieManager()
		if err != nil {
			return
		}
		defer cm.Release()

		list, err := cm.GetCookies(url)
		if err != nil {
			return
		}
		defer list.Release()

		count, err := list.GetCount()
		if err != nil {
			return
		}

		for i := uint32(0); i < count; i++ {
			cookie, err := list.GetItem(i)
			if err != nil {
				continue
			}

			name, _ := cookie.GetName()
			value, _ := cookie.GetValue()
			domain, _ := cookie.GetDomain()
			path, _ := cookie.GetPath()
			expires, _ := cookie.GetExpires()
			isHttpOnly, _ := cookie.GetIsHttpOnly()
			isSecure, _ := cookie.GetIsSecure()

			cookies = append(cookies, &http.Cookie{
				Name:     name,
				Value:    value,
				Domain:   domain,
				Path:     path,
				Expires:  time.Unix(int64(expires), 0),
				HttpOnly: isHttpOnly,
				Secure:   isSecure,
			})
			cookie.Release()
		}
	})

	wg.Wait()
	return cookies
}

func (w *windowsWebviewWindow) execJS(js string) {`);

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
