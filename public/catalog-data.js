(function attachCatalog(root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.ApexTyreCatalog = catalog;
}(globalThis, function createCatalog() {
  const carSizes = ['185/65 R15', '195/55 R16', '205/55 R16', '215/60 R16', '225/45 R17'];
  const bikeSizes = ['90/90-17', '100/80-17', '80/100-18', '110/80-17', '120/80-18'];
  const brands = [
    { brand: 'MRF', vehicle: 'Car', models: ['ZVTV', 'Perfinza', 'Wanderer', 'ZTX', 'ZLX', 'ZLO', 'Revz', 'Steel Muscle', 'Nylogrip', 'Mogrip'] },
    { brand: 'Apollo', vehicle: 'Car', models: ['Alnac 4G', 'Apterra AT2', 'Amazer 4G', 'ActiGrip S4', 'Tramplr ST', 'Aspire 4G', 'Amazer XP', 'Apterra HT2', 'Alpha H1', 'Amazer 3G'] },
    { brand: 'CEAT', vehicle: 'Car', models: ['SecuraDrive', 'Gripp X3', 'Milaze', 'Czar HP', 'Zoom', 'SportDrive', 'CrossDrive AT', 'Czar SUV', 'EnergyDrive', 'FuelSmarrt'] },
    { brand: 'Bridgestone', vehicle: 'Car', models: ['Turanza T005', 'Sturdo', 'Dueler D693', 'Ecopia EP150', 'Potenza RE050', 'B250', 'Dueler H/T 684', 'Alenza 001', 'Turanza 6', 'Ecopia EP300'] },
    { brand: 'Goodyear', vehicle: 'Car', models: ['Assurance TripleMax 2', 'Eagle F1', 'Wrangler AT', 'EfficientGrip Performance', 'Assurance Duraplus', 'Wrangler HP', 'Eagle NCT5', 'Assurance ComfortTred', 'Wrangler DuraTrac', 'EfficientGrip SUV'] },
    { brand: 'Michelin', vehicle: 'Car', models: ['Primacy 4+', 'Pilot Sport 4', 'LTX Force', 'Energy XM2+', 'Primacy SUV+', 'Pilot Sport 5', 'Latitude Sport 3', 'Latitude Tour HP', 'Energy XM2', 'Pilot Sport 3'] },
    { brand: 'JK Tyre', vehicle: 'Car', models: ['UX Royale', 'Ranger A/T', 'Elanzo', 'Blaze', 'Vectra', 'UX Touring', 'Taximaxx', 'Ranger H/T', 'Tornado', 'Brute'] },
    { brand: 'TVS Eurogrip', vehicle: 'Bike', models: ['Protorq Extreme', 'Remora', 'Pancer', 'Conta 625', 'Durapro', 'Jumbo GT', 'ATT 455', 'Terrabite', 'RoadHound', 'Eurogrip Jumbo'] },
    { brand: 'Ralco', vehicle: 'Bike', models: ['Blaster', 'Speed Blaster', 'Gripper', 'Tuff Up', 'Speed King', 'Tuffty', 'Street Boss', 'Terra King', 'Raptor', 'Yodha'] },
    { brand: 'Maxxis', vehicle: 'Car', models: ['MA-P5', 'Victra Sport 5', 'Bravo HP-M3', 'Premitra HP5', 'AT-771', 'Bravo A/T 980', 'MA-Z4S', 'MA-307', 'Maxxplore', 'M6029'] },
    { brand: 'Continental', vehicle: 'Car', models: ['UltraContact UC6', 'UltraContact UC7', 'ContiSportContact 5', 'CrossContact ATR', 'ContiPremiumContact 6', 'UltraContact', 'SportContact 7', 'CrossContact LX2', 'ContiComfortContact CC6', 'VanContact AP'] },
    { brand: 'Yokohama', vehicle: 'Car', models: ['BluEarth GT AE51', 'Earth-1 E400', 'Geolandar A/T G015', 'ADVAN Sport V105', 'BluEarth RV-02', 'Geolandar H/T G056', 'Geolandar X-AT G016', 'ADVAN Fleva V701', 'BluEarth AE50', 'Geolandar CV G058'] }
  ];
  let listingIndex = 0;
  const products = brands.flatMap((catalog, brandIndex) => catalog.models.map((model, modelIndex) => {
    const isBike = catalog.vehicle === 'Bike';
    const size = (isBike ? bikeSizes : carSizes)[modelIndex % (isBike ? bikeSizes.length : carSizes.length)];
    const catalogKey = `${catalog.brand}|${model}|${size}`;
    const product = {
      brand: catalog.brand,
      model,
      vehicle_type: catalog.vehicle,
      tyre_size: size,
      rim_size: isBike ? size.split('-').pop() : size.match(/R(\d+)$/)[1],
      price: isBike ? 1650 + modelIndex * 170 + brandIndex * 35 : 5200 + modelIndex * 620 + brandIndex * 140,
      discount: 0,
      stock_quantity: 0,
      catalog_key: catalogKey,
      listing_index: listingIndex
    };
    listingIndex += 1;
    return product;
  }));
  return { brands, products };
}));
