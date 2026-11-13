export interface MarketplaceUser {
  userId: string;
  name: string;
  role: 'Buyer' | 'Seller' | 'Support Agent';
  language: string;
  avatar: string;
  badgeColor: string;
}

export const DEMO_USERS: MarketplaceUser[] = [
  {
    userId: 'buyer_1',
    name: 'Aarav Sharma',
    role: 'Buyer',
    language: 'Hindi / English',
    avatar: 'https://api.dicebear.com/9.x/initials/svg?seed=Aarav',
    badgeColor: 'bg-blue-600',
  },
  {
    userId: 'seller_1',
    name: 'Rohan Tech Store',
    role: 'Seller',
    language: 'English',
    avatar: 'https://api.dicebear.com/9.x/initials/svg?seed=Rohan',
    badgeColor: 'bg-emerald-600',
  },
  {
    userId: 'agent_1',
    name: 'Priya (Support Lead)',
    role: 'Support Agent',
    language: 'Multi-language',
    avatar: 'https://api.dicebear.com/9.x/initials/svg?seed=Priya',
    badgeColor: 'bg-purple-600',
  },
];
