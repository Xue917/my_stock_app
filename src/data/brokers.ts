// src/data/brokers.ts
export interface BrokerConfig {
  id: string;
  name: string;
  discount: number;
  minFee: number;
}

export const BROKER_OPTIONS: BrokerConfig[] = [
  { id: 'cathay', name: '國泰證券 (2.8折 / 低消1元)', discount: 0.28, minFee: 1 },
  { id: 'sk888', name: '新光證券 (2.8折 / 低消1元)', discount: 0.28, minFee: 1 },
  { id: 'fubon', name: '富邦證券 (2.0折 / 低消1元)', discount: 0.20, minFee: 1 },
  { id: 'sinopac', name: '永豐金證券 (2.0折 / 低消1元)', discount: 0.20, minFee: 1 },
  { id: 'yuanta', name: '元大證券 (6.0折 / 低消20元)', discount: 0.60, minFee: 20 },
  { id: 'kgi', name: '凱基證券 (6.0折 / 低消20元)', discount: 0.60, minFee: 20 },
  { id: 'pocket', name: '口袋/玉山證券 (2.8折 / 低消1元)', discount: 0.28, minFee: 1 },
  { id: 'custom', name: '⚙️ 自訂券商', discount: 0.60, minFee: 20 },
];