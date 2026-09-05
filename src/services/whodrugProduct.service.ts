import { Op, WhereOptions } from 'sequelize';
import { WhodrugProduct } from '../models';
import { buildTextSearchConditions } from '../helpers';
import { WhodrugProductListFilters } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// SPEC F56 — the raw mirror of the WHODrug standard. name and ingredient are independent filters,
// not alternatives of a single search box: both narrow the result when both travel. ingredient
// queries ingredient AND ingredientTranslations at once, joined by Op.or, so an operator can type
// either the English principle or its Spanish translation
const buildWhodrugProductAdminWhere = (filters: WhodrugProductListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};

    const nameConditions = buildTextSearchConditions(filters.name, ['drugName']);
    if (nameConditions.length > 0) {
        Object.assign(where, nameConditions[0]);
    }

    const ingredientConditions = buildTextSearchConditions(filters.ingredient, ['ingredient', 'ingredientTranslations']);
    if (ingredientConditions.length > 0) {
        where[Op.or as unknown as string] = ingredientConditions;
    }

    return where;
}

// ESAVI-WHODPROD-002B - Get All Whodrug Products Service (inspection listing, admin only)
//
// This is the raw mirror, exactly as registered: vaccines included, no ATC exclusion and no
// country filter. Inactive rows are returned too — 002B is the administration variant and the
// route already gates it to ADMIN, which is what canViewInactive would otherwise decide
const getAllWhodrugProductsService = async (filters: WhodrugProductListFilters) => {
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const offset = filters.offset ?? DEFAULT_OFFSET;

    const whodrugProducts = await WhodrugProduct.findAndCountAll({
        where: buildWhodrugProductAdminWhere(filters),
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['drugName', 'ASC'], ['drugCode', 'ASC']],
        limit,
        offset
    });

    return whodrugProducts;
}

export {
    getAllWhodrugProductsService
};
