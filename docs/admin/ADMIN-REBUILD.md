# Admin Rebuild

The previous Admin application surface was intentionally reset after Product Owner review.

The backend and domain architecture remains preserved. The permanent RTL shell has no login UX. The first two connected pages are `/admin/ads/banners` and `/admin/content/storage`; each uses only its own local-admin backend boundary, while all other Admin domains remain disconnected.

Admin will be rebuilt page by page: design and approve each page first, then connect only the backend needed by that page. Production pages must not use fixtures, and the fresh local runtime does not seed demo banners.

Visual source of truth: `Abbashu0/Admin-Panel-Components-Library`

Local reference: `C:\Users\abbas\Desktop\Admin panel components library`

Student Mobile is independent and untouched.
