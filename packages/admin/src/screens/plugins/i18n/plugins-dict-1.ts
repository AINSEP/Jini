/**
 * @file Locale data for the plugins dictionary, part 1 of 21. Plain per-locale tables only; the factory in
 * `../plugins-i18n.ts` merges the parts and binds the host's names and common fallback.
 */

/**
 * @file Spanish translation for the `plugins` feature's own screens (`Plugins.tsx` and
 * `AgentPlugins.tsx`) — this feature's own dictionary, not the shared `lib/admin-nav-i18n.ts` one,
 * so parallel translation passes over other admin sections can't collide on the same file. Same
 * two-step fallback every other `t()` in this app uses: translated value, else the English source
 * string itself.
 */

export const PLUGINS_DICT_PART_1: Record<string, Record<string, string>> = {
  es: {
    "Signed in": "Sesión iniciada",
    "Not signed in": "Sesión no iniciada",
    "Waiting for sign-in": "Esperando el inicio de sesión",
    "Sign in again": "Vuelve a iniciar sesión",
    "Saved to your project — not used by any site yet": "Guardado en tu proyecto — ningún sitio lo usa todavía",
    "Used by {sites}": "Usado por {sites}",
    "Saved for this site only": "Guardado solo para este sitio",
    "Use the saved key for this site": "Usar la clave guardada en este sitio",
    "{name} settings saved": "Ajustes de {name} guardados",
    // Provider plugin settings card (2026-10-26).
    "Saved for this site": "Se guarda para este sitio",
    "Custom…": "Personalizado…",
    "Custom {label}": "{label} personalizado",
    "Settings": "Ajustes",
    "This is both an agent plugin and a regular plugin. It can only be turned on in the Plugins page.": "Es a la vez un plugin de agente y un plugin normal. Solo se puede activar en la página Plugins.",
    "{name} settings": "Ajustes de {name}",
    "A key for this plugin was saved in an older format that {productName} no longer reads. Enter it again here and save.": "Una clave de este plugin se guardó en un formato antiguo que {productName} ya no lee. Vuelve a introducirla aquí y guarda.",
    "Saved keys for this plugin can't be read on this machine. Enter them again here and save.": "Las claves guardadas de este plugin no se pueden leer en este equipo. Vuelve a introducirlas aquí y guarda.",
    "Saved — leave blank to keep": "Guardado: déjalo en blanco para conservarlo",
    "failed to load plugin settings": "no se pudieron cargar los ajustes del plugin",
    "failed to save plugin settings": "no se pudieron guardar los ajustes del plugin",
    // Agent Plugin compatibility, dependents and explicit update (2026-10-21).
    "Not for this {productName} version": "No es para esta versión de {productName}",
    "Needs {capabilities}": "Necesita {capabilities}",
    "{plugin} needs {capability}": "{plugin} necesita {capability}",
    "Update": "Actualizar",
    "Updating…": "Actualizando…",
    "Upload a newer version of this plugin as a .zip or a folder. It keeps its memory and stays on or off as it is now.": "Sube una versión más reciente de este plugin como .zip o carpeta. Conserva su memoria y sigue activado o desactivado como ahora.",
    "{name} is updated.": "{name} está actualizado.",
    "You added this package. Turning it off keeps its files and memory.": "Tú añadiste este paquete. Al desactivarlo se conservan sus archivos y su memoria.",
    "Other enabled plugins rely on it:": "Otros plugins activados dependen de él:",
    "This plugin changed since this page loaded. Reload the page and try again.": "Este plugin cambió desde que se cargó esta página. Recarga la página e inténtalo de nuevo.",
    "This package is an older version than the one installed.": "Este paquete es una versión anterior a la instalada.",
    "This package is a different plugin.": "Este paquete es otro plugin.",
    "Plugins that ship with {productName} update with {productName}.": "Los plugins incluidos con {productName} se actualizan con {productName}.",
    "An earlier update is still being recovered. Restart {productName} and try again.": "Todavía se está recuperando una actualización anterior. Reinicia {productName} e inténtalo de nuevo.",
    "Replaces the installed version with a newer one. Older versions are refused.": "Reemplaza la versión instalada por una más reciente. Las versiones anteriores se rechazan.",
    "The new version's MCP servers could not be set up; the previous version was restored.": "No se pudieron configurar los servidores MCP de la nueva versión; se restauró la versión anterior.",
    "This plugin is not made for this {productName} version.": "Este plugin no está hecho para esta versión de {productName}.",
    "Could not update the plugin. Try again.": "No se pudo actualizar el plugin. Inténtalo de nuevo.",
    "This package has no release version to compare.": "Este paquete no tiene una versión de lanzamiento para comparar.",
    "Same version number as the installed one, with different contents.": "Mismo número de versión que el instalado, con contenido diferente.",
    // Plugins "Add a plugin" tab and the bundled-only uninstall footnote (2026-10-06).
    "{name} is installed and switched off. Turn it on in Downloaded.": "{name} está instalado y desactivado. Actívalo en Descargado.",
    "Plugins that ship with {productName} can't be uninstalled: they come back on the next restart. To remove one you added, ask the assistant.": "Los plugins incluidos con {productName} no se pueden desinstalar: vuelven en el próximo reinicio. Para quitar uno que añadiste, pídeselo al asistente.",
    // Agent Plugins "Add a plugin" tab (2026-10-06).
    "Add a plugin": "Añadir un plugin",
    "Install a package you already have.": "Instala un paquete que ya tienes.",
    "Install an Agent Plugin package from a .zip. New plugins stay off until you switch them on in Installed.": "Instala un paquete de Plugin de agentes desde un .zip. Los plugins nuevos quedan desactivados hasta que los actives en Instalado.",
    "Upload a .zip": "Subir un .zip",
    "Drop a .zip here": "Suelta un .zip aquí",
    "An agent-plugins.org package with plugin.json at its top. Up to 32 MiB.": "Un paquete de agent-plugins.org con plugin.json en la raíz. Hasta 32 MiB.",
    "Choose a file": "Elegir un archivo",
    "Upload a .zip or a folder": "Subir un .zip o una carpeta",
    "A .zip or a plugin folder, up to 32 MiB.": "Un .zip o una carpeta de plugin, hasta 32 MiB.",
    "Choose a folder": "Elegir una carpeta",
    "Choose a plugin folder": "Elegir una carpeta de plugin",
    "Advanced: install from a path on this server": "Avanzado: instalar desde una ruta de este servidor",
    "The full path of a plugin folder on the computer running {productName}.": "La ruta completa de una carpeta de plugin en el equipo que ejecuta {productName}.",
    "That folder is empty.": "Esa carpeta está vacía.",
    "Could not read that folder. Try again.": "No se pudo leer esa carpeta. Inténtalo de nuevo.",
    "That folder has more than 4096 files.": "Esa carpeta tiene más de 4096 archivos.",
    "Installing…": "Instalando…",
    "From a URL": "Desde una URL",
    "Coming soon": "Próximamente",
    "Install from a repository or a .zip link.": "Instala desde un repositorio de Git o un enlace a un .zip.",
    "Plugin URL": "URL del plugin",
    "Add from URL": "Añadir desde URL",
    "{name} is already installed.": "{name} ya está instalado.",
    "{name} is installed and switched off. Turn it on in Installed.": "{name} está instalado y desactivado. Actívalo en Instalado.",
    "The .zip is larger than the 32 MiB limit.": "El .zip supera el límite de 32 MiB.",
    "The upload arrived damaged. Try again.": "La subida llegó dañada. Inténtalo de nuevo.",
    "No plugin.json found. Put plugin.json at the top of the .zip, or inside one folder.": "No se encontró plugin.json. Ponlo en la raíz del .zip o dentro de una sola carpeta.",
    "plugin.json is not a valid Agent Plugin manifest.": "plugin.json no es un manifiesto válido de Plugin de agentes.",
    "This file is not a readable .zip.": "Este archivo no es un .zip legible.",
    "A different plugin with this name is already installed.": "Ya hay instalado otro plugin con este nombre.",
    "The .zip is too big once unpacked: at most 4096 files, 16 MiB per file, 64 MiB in all.": "El .zip es demasiado grande al descomprimirse: como máximo 4096 archivos, 16 MiB por archivo y 64 MiB en total.",
    "You don't have permission to install plugins.": "No tienes permiso para instalar plugins.",
    "This .zip contains files or links that plugins may not include.": "Este .zip contiene archivos o enlaces que los plugins no pueden incluir.",
    "Could not install the plugin. Try again.": "No se pudo instalar el plugin. Inténtalo de nuevo.",
    "Choose one .zip file.": "Elige un solo archivo .zip.",
    // Agent Plugin row: the agent-facing description behind its owner-facing summary (2026-10-06).
    // Plugin conflict detection (2026-10-04): conflict lines, quarantine headline, PLUGIN_CONFLICT.
    "Turned off automatically": "Desactivado automáticamente",
    "Quarantined after {count} consecutive failures": "En cuarentena tras {count} fallos consecutivos",
    "Names already in use — turn the other plugin off first:": "Nombres ya en uso; desactiva primero el otro plugin:",
    "{kind} \"{key}\" is already used by {plugin}.": "{kind} \"{key}\": ya en uso por {plugin}.",
    "{kind} \"{key}\" is reserved by {productName}.": "{kind} \"{key}\": {productName} lo reserva.",
    "{kind} \"{key}\" is reserved by {productName} (\"{reserved}\").": "{kind} \"{key}\": {productName} lo reserva (\"{reserved}\").",
    "Route": "Ruta",
    "Tool": "Herramienta",
    "Table": "Tabla",
    "Setting": "Ajuste",
    "Widget": "Widget",
    "Permission": "Permiso",
    "Hook": "Hook",
    "This plugin uses names that core or another plugin already has. Open its details to see which, and turn the other plugin off first.": "Este plugin usa nombres que ya tiene el núcleo u otro plugin. Abre sus detalles para ver cuáles y desactiva primero el otro plugin.",
    "Upload .zip (max 32 MiB)": "Subir .zip (máx. 32 MiB)",
    "ZIP exceeds the upload or expanded package size limit.": "El ZIP supera el límite de carga o de tamaño del paquete descomprimido.",
    // Local folder install consent and errors (owner-approved plan, 2026-09-22).
    "Install plugin": "Instalar plugin",
    "Folder on this server": "Carpeta en este servidor",
    "Replace existing version": "Reemplazar la versión existente",
    "Preview plugin": "Revisar plugin",
    "Install (stays off)": "Instalar (queda desactivado)",
    "Local plugin · unverified publisher": "Plugin local · editor no verificado",
    "Capabilities": "Capacidades",
    "Hooks": "Hooks",
    "This plugin runs code with full access to this computer and every site on it.": "Este plugin ejecuta código con acceso completo a este ordenador y a todos sus sitios.",
    "It stays off in every workspace until you turn it on.": "Permanece desactivado en todos los espacios de trabajo hasta que lo actives.",
    // AW-7 Tier 1 + plugin-conflicts install preview (2026-10-04).
    "Content type": "Tipo de contenido",
    "Content types": "Tipos de contenido",
    "This plugin has no code; nothing in it runs on this computer. Turning it on only adds what it declares.": "Este plugin no tiene código; nada de él se ejecuta en este ordenador. Activarlo solo añade lo que declara.",
    // Plugin row detail panel (PL-2, 2026-10-06): the facts every row lists, healthy or not.
    "Plugin details": "Detalles del plugin",
    ID: "ID",
    Access: "Acceso",
    State: "Activación",
    "Built in — ships with {productName}": "Integrado — incluido con {productName}",
    "Installed on this site": "Instalado en este sitio",
    "This plugin runs code in a separate worker, limited to the capabilities it declares.": "Este plugin ejecuta código en un proceso aparte, limitado a las capacidades que declara.",
    "No problems found": "No se encontraron problemas",
    "Invalid — see the errors below": "No válido — consulta los errores a continuación",
    "Not compatible with this version of {productName}": "No es compatible con esta versión de {productName}",
    "On in this workspace": "Activado en este espacio de trabajo",
    "Off in this workspace": "Desactivado en este espacio de trabajo",
    "Already in use in this workspace (other workspaces are checked when you turn it on there):": "Ya en uso en este espacio de trabajo (los demás espacios se comprueban al activarlo en ellos):",
    "Failed to preview plugin.": "No se pudo revisar el plugin.",
    "Failed to install plugin.": "No se pudo instalar el plugin.",
    "Package changed. Review it again before installing.": "El paquete cambió. Revísalo de nuevo antes de instalarlo.",
    "Local folder installs are disabled on this server.": "La instalación desde carpetas locales está desactivada en este servidor.",
    "Turn this plugin off in every workspace before installing.": "Desactiva este plugin en todos los espacios de trabajo antes de instalarlo.",
    "Installation conflicts with an existing plugin. Check its version and replacement option.": "La instalación entra en conflicto con un plugin existente. Comprueba su versión y la opción de reemplazo.",
    "Invalid plugin package. Check its manifest, integrity and folder.": "Paquete de plugin no válido. Comprueba su manifiesto, integridad y carpeta.",
    // i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
    // by t() with no dictionary entry in this locale at all.
    "Portable packages installed for this workspace.": "Paquetes portables instalados para este espacio de trabajo.",
    "This deletes the plugin's files from this site. This cannot be undone — reinstalling starts from scratch.": "Esto elimina los archivos del plugin de este sitio. No se puede deshacer; al reinstalar se empieza desde cero.",
    "This turns it off: its skills stop reaching the assistant on the next run, and it drops off the Installed tab. ": "Esto lo desactiva: sus habilidades dejarán de llegar al asistente en la próxima ejecución y desaparecerá de la pestaña Instalados. ",
    "It stays right here on Downloaded and can be enabled again any time.": "Seguirá aquí mismo en Descargados y podrás activarlo de nuevo en cualquier momento.",
    "This package ships with {productName} — it can't be deleted outright, only turned off.": "Este paquete viene con {productName}; no se puede eliminar por completo, solo desactivar.",
    "Its skills stop reaching the assistant on the next run. The package stays on disk and can be enabled again.": "Sus habilidades dejarán de llegar al asistente en la próxima ejecución. El paquete permanece en el disco y puede activarse de nuevo.",
    Enable: "Activar",
    Disable: "Desactivar",
    "Turn off": "Desactivar",
    "Move to trash": "Mover a la papelera",
    "This plugin is already in the Trash. Restore or delete it there first.": "Este plugin ya está en la Papelera. Restáuralo o elimínalo allí primero.",
    "This removes it for all workspaces on this site. You can restore it from the Trash for 60 days.": "Esto lo elimina de todos los espacios de trabajo de este sitio. Puedes restaurarlo desde la Papelera durante 60 días.",
    "Inspect package files": "Inspeccionar los archivos del paquete",
    // "Add-Ons" -> "Integrations" 2026-09-10: the nav group this page's kicker names was renamed
    // (see `panels.tsx`'s own comment on the group). Only `es` carried a value for this key until
    // 2026-10-05 — a pre-existing gap, not introduced by this rename; every other locale fell
    // through to the English key itself. The other locales now reuse `admin-nav-i18n.ts`'s word.
    Integrations: "Integraciones",
    Plugins: "Plugins",
    "Loading plugins…": "Cargando plugins…",
    "Enable or disable plugins discovered in this site's plugin install directory.":
      "Activa o desactiva los plugins detectados en el directorio de instalación de plugins de este sitio.",
    "No plugins installed.": "No hay plugins instalados.",
    "A new one appears here on the next load, once it's unpacked into the site's plugin install directory.":
      "Uno nuevo aparecerá aquí en la próxima carga, una vez que se descomprima en el directorio de instalación de plugins del sitio.",
    Version: "Versión",
    Source: "Origen",
    Tier: "Nivel",
    Enabled: "Activado",
    "Disabled": "Desactivado",
    "Uninstall": "Desinstalar",
    "unavailable": "no disponible",
    Errors: "Errores",
    "Agent Plugins": "Plugins de agentes",
    "Agent Plugins is coming soon.": "Los plugins de agentes estarán disponibles próximamente.",
    "This is from the": "Esto proviene del",
    "Agent Plugins open standard": "estándar abierto Agent Plugins",
    "— packaging skills, tools, and MCP servers into portable plugins.":
    "— que empaqueta habilidades, herramientas y servidores MCP en plugins portables.",

    // AgentPlugins.tsx's Downloaded/Installed tab split (2026-09-09) — new strings that split
    // introduced. Downloaded's own lede/empty-state reuse pre-split keys verbatim (see this file's
    // git history — those two were ALREADY untranslated at HEAD before the split, not something
    // this pass broke), so only the genuinely new copy is added here.
    Downloaded: "Descargado",
    "Downloaded Agent Plugins": "Plugins de agentes descargados",
    "Every package downloaded to this workspace.": "Todos los paquetes descargados en este espacio de trabajo.",
    "No Agent Plugins are enabled for this workspace.": "No hay Plugins de agentes activados en este espacio de trabajo.",
    "These plugins are enabled. Their skills reach the assistant's prompt on every run.":
      "Estos plugins están activados. Sus habilidades llegan al prompt del asistente en cada ejecución.",
    // 2026-09-13: Installed lists every installed Agent Plugin, switched on or off.
    "Every plugin installed in this workspace. Only switched-on plugins reach the assistant's prompt.":
      "Todos los plugins instalados en este espacio de trabajo. Solo los activados llegan al prompt del asistente.",
    "Until then, the downloaded packages on the Downloaded tab are the ones {productName} ships.":
      "Mientras tanto, los paquetes descargados en la pestaña Descargados son los que incluye {productName}.",

    // Pre-existing gap, not introduced by the Downloaded/Installed split above: the Installed and
    // Marketplace tab labels, the reused Downloaded lede/empty-state, and the whole Marketplace
    // panel's own copy had no dictionary entry at all before this split (verified against the
    // commit before it started) — this closes that, all at once, rather than leaving the Spanish
    // view of this screen half-translated in a way later work would misattribute to the split.
    Installed: "Instalado",
    Marketplace: "Mercado",
    "An installed plugin sits inert until you enable it. Enabling one puts its skills in the assistant's prompt for every run.":
      "Un plugin instalado permanece inactivo hasta que lo activas. Activarlo hace que sus habilidades lleguen al prompt del asistente en cada ejecución.",
    "No Agent Plugins are installed in this workspace.": "No hay Plugins de agentes instalados en este espacio de trabajo.",
    "Agent Plugin Marketplace": "Mercado de plugins de agentes",
    "A future place to discover portable Agent Plugins.": "Un futuro lugar para descubrir Plugins de agentes portables.",
    "Nothing to browse yet": "Todavía no hay nada para explorar",
    "Marketplace is planned for a future release. {productName} does not fetch, install, or list marketplace packages yet.":
      "El mercado está planeado para una versión futura. {productName} aún no descarga, instala ni lista paquetes del mercado.",
    "Read the package format": "Leer el formato del paquete",
    "Package format:": "Formato del paquete:",

    // Plugins.tsx's Installed/Downloaded/Marketplace tab rebuild (2026-09-09) — this screen's OWN
    // new copy. "Installed"/"Downloaded"/"Marketplace"/"Nothing to browse yet" are reused verbatim
    // from the keys above (shared tab-label vocabulary across both screens in this dictionary).
    Remove: "Eliminar",
    "Enabled plugins extend what this site can do.": "Los plugins activados amplían lo que este sitio puede hacer.",
    "Built-in plugins ship with {productName} itself and have no on-disk files to remove.":
      "Los plugins integrados se incluyen con el propio {productName} y no tienen archivos en disco para eliminar.",
    "Turn a plugin off on Installed before removing it.": "Desactiva el plugin en Instalado antes de eliminarlo.",
    "Marketplace is planned for a future release. {productName} does not fetch, list, or install plugins from a marketplace yet.":
      "El mercado está planeado para una versión futura. {productName} aún no descarga, lista ni instala plugins desde un mercado.",
    "Install a plugin by placing its files in this site's plugin install directory.":
      "Instala un plugin colocando sus archivos en el directorio de instalación de plugins de este sitio.",

    // Hook-level notice/error strings (use-plugins.hooks.ts) — these never got translated during
    // the JSX-only pass since they live in `.hooks.ts` files.
    "failed to load plugins": "no se pudieron cargar los plugins",
    "failed to update plugin": "no se pudo actualizar el plugin",
    "failed to remove plugin": "no se pudo eliminar el plugin",
    "failed to update agent plugin": "no se pudo actualizar el plugin de agentes",
    "failed to load agent plugins": "no se pudieron cargar los plugins de agentes",

    // PackageFilesModal / PluginPackageFilesModal (2026-09-13).
    "package files": "archivos del paquete",
    "Read-only source bundled with {productName}; this plugin is not executed from this screen.": "Código fuente de solo lectura incluido con {productName}; este plugin no se ejecuta desde esta pantalla.",
    "No source files are catalogued for this package.": "No hay archivos de código fuente catalogados para este paquete.",
    "Package files": "Archivos del paquete",
    "Loading package files…": "Cargando archivos del paquete…",
    "No files to show for this plugin.": "No hay archivos para mostrar de este plugin.",
    "failed to load package files": "no se pudieron cargar los archivos del paquete",
    "Binary file — not shown.": "Archivo binario: no se muestra.",
    "Too large to show here.": "Demasiado grande para mostrarlo aquí.",
    "Symbolic link — not followed.": "Enlace simbólico: no se sigue.",
    "This file could not be read.": "No se pudo leer este archivo.",
    "Some files are not listed: this package is larger than the viewer's limits.": "Algunos archivos no aparecen: este paquete supera los límites del visor.",
    // Plugin-owned admin surface frame notices (2026-10-20).
    "This view left its page and was closed. Close and reopen the plugin to use it again.": "Esta vista salió de su página y se cerró. Cierra y vuelve a abrir el plugin para usarla de nuevo.",
    "Could not open this view. Close and reopen the plugin to try again.": "No se pudo abrir esta vista. Cierra y vuelve a abrir el plugin para intentarlo de nuevo.",
    "Sign-in opens in your browser.": "El inicio de sesión se abre en tu navegador.",
    "Continue to sign-in": "Continuar al inicio de sesión",
  },
};
