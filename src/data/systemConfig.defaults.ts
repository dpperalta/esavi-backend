import { SystemConfigDefault } from '../types';

/**
 * The declarative catalogue ESAVI-SYSCONF-008 seeds from.
 *
 * THIS FILE TENDS TO GROW. Adding a parameter to the application is adding an entry here and calling
 * POST /api/system-configs/sync again after deploying. That is the whole cost of the mechanism, and
 * it is the reason the seeding is an endpoint and not a migration.
 *
 * The 008 is ONLY-INSERT. It creates what is missing and touches nothing that already exists —
 * neither the value, nor the name, nor the state, and an inactive row counts as existing and is not
 * reactivated. What is in production wins over the default, and that is the single rule keeping a
 * deploy from silently stepping on a hand-tuned configuration.
 *
 * EIGHT OF THESE ROWS ARE NOW CONSUMED AT RUNTIME — the six of scope MAIL and the two of scope AUTH,
 * read by `src/helpers/appConfig.helper.ts` on every password reset email. SPEC F43 §3.6 is the first
 * consumer of this table and the one that fixes the precedence for the first time: FOR THOSE EIGHT
 * CODES THE DATABASE WINS AND .env IS THE FALLBACK, read on every send, without a cache.
 *
 * THE REST STILL COMES FROM .env. `pagination.constants.ts` still reads ESAVI_APP_DEFAULT_LIMIT from
 * the environment and CORS_ORIGINS is still resolved in app.ts. Bringing those down to the database
 * is the configuration spec of its own that SPEC F26 §2 declared out of scope, and SPEC F43 §2 keeps
 * out of scope. What this catalogue does for them today is make the rows exist, with their history
 * and their audit trail, so that migration has somewhere to land.
 *
 * Every field is declared explicitly, without leaning on the DEFAULTs of the DDL. `code` and `scope`
 * are written in the shape toConstantCase would produce, so what is read here is what ends up stored.
 */
export const SYSTEM_CONFIG_DEFAULTS: SystemConfigDefault[] = [
    {
        code: 'ESAVI_APP_DEFAULT_LIMIT',
        name: 'Límite de paginación por defecto',
        description: 'Número de filas que devuelve un listado cuando la petición no indica limit. Hoy lo lee src/constants/pagination.constants.ts desde el entorno.',
        value: 10,
        valueType: 'number',
        scope: 'PAGINATION',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_APP_DEFAULT_OFFSET',
        name: 'Desplazamiento de paginación por defecto',
        description: 'Posición inicial de un listado cuando la petición no indica offset.',
        value: 0,
        valueType: 'number',
        scope: 'PAGINATION',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_APP_MAX_LIMIT',
        name: 'Límite máximo de paginación',
        description: 'Techo de filas por página que aceptan los validadores de listado. Protege de una consulta que pida el catálogo entero.',
        value: 100,
        valueType: 'number',
        scope: 'PAGINATION',
        // Not editable: raising it from a screen would let a single request drag the whole table, and
        // the validators of every listing check against this ceiling
        isEncrypted: false,
        isEditable: false
    },
    {
        code: 'ESAVI_SUPPORTED_LANGUAGES',
        name: 'Idiomas soportados',
        description: 'Códigos de idioma que acepta languageMiddleware. Cada uno tiene que tener su fichero en src/data/i18n.',
        value: ['es', 'en', 'nl'],
        valueType: 'array',
        scope: 'I18N',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_DEFAULT_LANGUAGE',
        name: 'Idioma por defecto',
        description: 'Idioma que resuelve languageMiddleware cuando la petición no indica ninguno o el que indica no está soportado.',
        value: 'es',
        valueType: 'string',
        scope: 'I18N',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MAX_UPLOAD_SIZE_MB',
        name: 'Tamaño máximo de fichero',
        description: 'Tope en megabytes de los ficheros de importación masiva: MedDRA, WHODrug y catálogos .xlsx.',
        value: 20,
        valueType: 'number',
        scope: 'UPLOAD',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_NOTIFICATION_DEADLINE_DAYS',
        name: 'Plazo de notificación en días',
        description: 'Días desde la fecha del evento dentro de los cuales una notificación se considera dentro de plazo.',
        value: 30,
        valueType: 'number',
        scope: 'NOTIFICATION',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MAIL_SMTP_HOST',
        name: 'Servidor SMTP',
        description: 'Host del servidor de correo saliente. Lo lee src/helpers/appConfig.helper.ts en cada envío. Se siembra vacío: es configuración de despliegue y se carga con ESAVI-SYSCONF-004.',
        value: '',
        valueType: 'string',
        scope: 'MAIL',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MAIL_SMTP_PORT',
        name: 'Puerto SMTP',
        description: 'Puerto del servidor de correo saliente. 587 es el de envío con STARTTLS; 465 va con ESAVI_MAIL_SMTP_SECURE en true.',
        value: 587,
        valueType: 'number',
        scope: 'MAIL',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MAIL_SMTP_SECURE',
        name: 'SMTP sobre TLS implícito',
        description: 'true abre la conexión ya cifrada, lo que corresponde al puerto 465. false negocia STARTTLS, que es lo habitual en el 587.',
        value: false,
        valueType: 'boolean',
        scope: 'MAIL',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MAIL_SMTP_USER',
        name: 'Usuario SMTP',
        description: 'Usuario de autenticación contra el servidor de correo. Se siembra vacío y se carga con ESAVI-SYSCONF-004.',
        value: '',
        valueType: 'string',
        scope: 'MAIL',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MAIL_SMTP_PASSWORD',
        name: 'Contraseña SMTP',
        description: 'Contraseña de autenticación contra el servidor de correo. Es la primera fila cifrada del catálogo: se guarda como { enc: "..." } y solo un SUPERADMIN puede leerla en claro.',
        value: '',
        valueType: 'string',
        scope: 'MAIL',
        // The only encrypted row of the catalogue. A credential seeded empty in git and loaded
        // afterwards with the 004, which is precisely what isEncrypted exists for
        isEncrypted: true,
        isEditable: true
    },
    {
        code: 'ESAVI_MAIL_FROM',
        name: 'Remitente del correo',
        description: 'Dirección que figura como remitente de los correos que envía la aplicación. Se siembra vacía y se carga con ESAVI-SYSCONF-004.',
        value: '',
        valueType: 'string',
        scope: 'MAIL',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_PASSWORD_RESET_URL',
        name: 'URL de restablecimiento de contraseña',
        description: 'Ruta pública del frontend que lee ?token= de la URL y lo manda en el cuerpo de ESAVI-AUTH-007. El enlace del correo es esta URL con ?token=<resetId>.<secreto>.',
        value: '',
        valueType: 'string',
        scope: 'AUTH',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_PASSWORD_RESET_EXPIRES_MINUTES',
        name: 'Caducidad del enlace de restablecimiento',
        description: 'Minutos de vida de un enlace de restablecimiento de contraseña. Suficiente para leer un correo, corto para un enlace que autoriza a escribir una contraseña.',
        value: 30,
        valueType: 'number',
        scope: 'AUTH',
        // Editable, unlike ESAVI_APP_MAX_LIMIT: the reasonable window depends on the deployment,
        // and whoever can edit it is already SUPERADMIN
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MEDDRA_ENABLED',
        name: 'Búsqueda de términos MedDRA habilitada',
        description: 'Interruptor general de ESAVI-MEDDRA-006. Con el valor en false el endpoint responde 503 sin salir a la red. Se siembra apagado a propósito: un despliegue recién sincronizado no debe empezar a llamar a un API licenciado por haber corrido el sync.',
        value: false,
        valueType: 'boolean',
        scope: 'MEDDRA',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MEDDRA_USERNAME',
        name: 'Usuario del API de MedDRA',
        description: 'Usuario del grant OAuth2 password contra MedDRA. Se siembra vacío y se carga con ESAVI-SYSCONF-004.',
        value: '',
        valueType: 'string',
        scope: 'MEDDRA',
        // Encrypted, unlike ESAVI_MAIL_SMTP_USER which travels in clear. In MedDRA the user IS the
        // licence identifier and leaking it has contractual consequences; an SMTP user has none
        isEncrypted: true,
        isEditable: true
    },
    {
        code: 'ESAVI_MEDDRA_PASSWORD',
        name: 'Contraseña del API de MedDRA',
        description: 'Contraseña del grant OAuth2 password contra MedDRA. Se guarda como { enc: "..." } y solo un SUPERADMIN puede leerla en claro.',
        value: '',
        valueType: 'string',
        scope: 'MEDDRA',
        isEncrypted: true,
        isEditable: true
    },
    {
        code: 'ESAVI_MEDDRA_TOKEN_URL',
        name: 'Endpoint del token de MedDRA',
        description: 'URL del grant OAuth2 contra la que el servicio pide el token de acceso.',
        value: 'https://mid.meddra.org/connect/token',
        valueType: 'string',
        scope: 'MEDDRA',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MEDDRA_SEARCH_URL',
        name: 'Endpoint de búsqueda de MedDRA',
        description: 'URL a la que el servicio manda el cuerpo de búsqueda con el token en la cabecera Authorization.',
        value: 'https://mapisbx.meddra.org/api/search',
        valueType: 'string',
        scope: 'MEDDRA',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MEDDRA_CLIENT_ID',
        name: 'client_id del grant OAuth2 de MedDRA',
        description: 'Identificador de cliente del grant OAuth2. Configurable pese a llevar años sin cambiar: cuando cambie, editar una fila es más barato que desplegar.',
        value: 'mspclient',
        valueType: 'string',
        scope: 'MEDDRA',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MEDDRA_OAUTH_SCOPE',
        name: 'scope del grant OAuth2 de MedDRA',
        description: 'Alcance que el servicio pide al endpoint del token.',
        value: 'meddraapi',
        valueType: 'string',
        scope: 'MEDDRA',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_MEDDRA_SEARCH_CONFIG',
        name: 'Cuerpo de la búsqueda de MedDRA',
        description: 'Los veinte parámetros de la consulta al API. El servicio solo reescribe searchterms[0].searchterm y language; el resto viaja intacto. version y take se cambian editando esta fila, no tocando código.',
        value: {
            addlangs: [],
            bview: 'SOC',
            contains: true,
            filters: [],
            hlgt: false,
            hlt: false,
            idiacritical: true,
            kana: false,
            language: 'Spanish',
            llt: true,
            pt: false,
            rsview: 'release',
            searchterms: [
                {
                    searchlogic: 0,
                    searchterm: '',
                    searchtype: 0
                }
            ],
            separator: 2,
            skip: 0,
            smq: false,
            soc: false,
            stype: 1,
            synonym: true,
            take: 20,
            version: 28
        },
        valueType: 'json',
        scope: 'MEDDRA',
        isEncrypted: false,
        isEditable: true
    },
    {
        code: 'ESAVI_SEVERE_CASE_ALERT_HOURS',
        name: 'Horas para alertar un caso grave',
        description: 'Horas desde el registro de un caso grave tras las cuales queda marcado como pendiente de revisión.',
        value: 24,
        valueType: 'number',
        scope: 'NOTIFICATION',
        isEncrypted: false,
        isEditable: true
    }
];
