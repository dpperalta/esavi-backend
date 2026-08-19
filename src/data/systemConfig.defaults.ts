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
 * NOBODY CONSUMES THESE ROWS YET. The startup code keeps reading .env exactly as it did before —
 * `pagination.constants.ts` still reads ESAVI_APP_DEFAULT_LIMIT from the environment, and CORS_ORIGINS
 * is still resolved in app.ts. Deciding which parameters come down to the database, in what order and
 * which source wins while the two coexist is a configuration spec of its own, declared out of scope
 * by SPEC F26 §2. What this catalogue does today is make the rows exist, with their history and their
 * audit trail, so that migration has somewhere to land.
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
