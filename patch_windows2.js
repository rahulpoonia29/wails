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

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
