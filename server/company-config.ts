interface CompanyPickupPointConfig {
  operations: number[];
  reports: number[];
  balcao: number[];
}

const companyPickupPointConfigs: Record<number, CompanyPickupPointConfig> = {
  1: {
    operations: [4, 58],
    reports: [1, 2, 4, 58],
    balcao: [1, 2],
  },
  3: {
    operations: [60, 61],
    reports: [52, 54, 60, 61],
    balcao: [52, 54],
  },
};

export function getCompanyOperationPickupPoints(companyId: number): number[] | null {
  return companyPickupPointConfigs[companyId]?.operations || null;
}

export function getCompanyReportPickupPoints(companyId: number): number[] | null {
  return companyPickupPointConfigs[companyId]?.reports || null;
}

export function getCompanyBalcaoPickupPoints(companyId: number): number[] | null {
  return companyPickupPointConfigs[companyId]?.balcao || null;
}

export function hasPickupPointRestriction(companyId: number): boolean {
  return !!companyPickupPointConfigs[companyId];
}
