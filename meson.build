project(
  'true-screen',
  version: '0.0.1',
  meson_version: '>= 1.3.0',
)

app_id = 'io.plutostudio.TrueScreen'
extension_uuid = 'true-screen@plutostudio.io'
extension_dir = join_paths(
  get_option('datadir'),
  'gnome-shell',
  'extensions',
  extension_uuid,
)

install_data(
  'extension/' + extension_uuid + '/extension.js',
  'extension/' + extension_uuid + '/implementation.js',
  'extension/' + extension_uuid + '/edge-router.js',
  'extension/' + extension_uuid + '/desktop-ruler.js',
  'extension/' + extension_uuid + '/metadata.json',
  install_dir: extension_dir,
)

summary(
  {
    'Application ID': app_id,
    'Extension UUID': extension_uuid,
    'Phase': 'Phase 1 developer prototype',
  },
  section: 'True Screen',
)
