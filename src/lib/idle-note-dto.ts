// Сериализуемый тип пометки о простое для границы сервер↔клиент (02.07). Без импортов prisma.
// Водителю пометки не отдаются ни в каком виде — тип используют только диспетчерские экраны.
export type IdleNoteView = {
  id: string;
  driverId: string;
  driverName: string;
  date: string; // YYYY-MM-DD
  minutes: number;
  note: string | null;
  kpiMarkId: string | null; // созданный из пометки штраф (MANUAL); null — не штрафовали
  createdAt: string;
};
