import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MENU_ITEMS = [
  {
    name: "Special Borito",
    nameAmharic: "ስፔሻል ቦሪቶ",
    description: "Signature warm flatbread wrap loaded with spiced sautéed beef, scrambled eggs, fresh herbs, and house awaze sauce.",
    price: 220,
    category: "Borito",
    imageUrl: "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  },
  {
    name: "Classic Ertib",
    nameAmharic: "ክላሲክ እርጥብ",
    description: "Crisp shredded artisan crust soaked in rich, slow-simmered spiced meat broth, finished with seasoned clarified butter (kibe) & berbere.",
    price: 180,
    category: "Ertib",
    imageUrl: "https://images.unsplash.com/photo-1543353071-873f17a7a088?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  },
  {
    name: "Chechebsa with Honey & Kibe",
    nameAmharic: "ጨጨብሳ በማርና ንጥር ቅቤ",
    description: "Traditional pan-tossed shredded pita flatbread drenched in spiced clarified butter (kibe), pure highland honey, and mild berbere.",
    price: 160,
    category: "Classics",
    imageUrl: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  },
  {
    name: "Special Ful with Egg & Yogurt",
    nameAmharic: "ስፔሻል ፉል በእንቁላልና እርጎ",
    description: "Slow-simmered fava beans seasoned with extra virgin olive oil, cumin, diced tomatoes, jalapeños, boiled egg, and cool yogurt dip.",
    price: 140,
    category: "Classics",
    imageUrl: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  },
  {
    name: "Shiro Tegabino with Injera",
    nameAmharic: "ሽሮ ተጋቢኖ በእንጀራ",
    description: "Rich, bubbling powdered chickpea stew slow-cooked in traditional earthenware with garlic and spices, served with soft injera.",
    price: 150,
    category: "Classics",
    imageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  },
  {
    name: "Beef Tibs Borito",
    nameAmharic: "የበሬ ጥብስ ቦሪቶ",
    description: "Tender cubes of prime beef flash-sautéed with red onions, rosemary sprigs, and green chili rolled inside a toasted flatbread wrap.",
    price: 250,
    category: "Borito",
    imageUrl: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  },
  {
    name: "Egg & Avocado Ertib",
    nameAmharic: "የእንቁላልና አቮካዶ እርጥብ",
    description: "Warm crust bread bites infused with savory spiced herbal broth, layered with freshly sliced avocado, scrambled egg, and mild green chillies.",
    price: 170,
    category: "Ertib",
    imageUrl: "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  },
  {
    name: "Fasting Veggie Combo Borito",
    nameAmharic: "የጾም ቦሪቶ",
    description: "100% plant-based wrap packed with spiced red lentil wot (misir), yellow split peas, sautéed collard greens (gomen), and potatoes.",
    price: 130,
    category: "Borito",
    imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  },
  {
    name: "Traditional Spiced Tea",
    nameAmharic: "የቅመም ሻይ",
    description: "Highland black tea slow-steeped with whole cloves, green cardamom pods, cinnamon bark, and fresh ginger.",
    price: 30,
    category: "Hot Drinks",
    imageUrl: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  },
  {
    name: "Habesha Jebena Buna",
    nameAmharic: "የጀበና ቡና",
    description: "Freshly pan-roasted single-origin Ethiopian Arabica coffee brewed in a traditional black clay jebena, served with fresh tena adam (rue herb).",
    price: 40,
    category: "Hot Drinks",
    imageUrl: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80",
    isAvailable: true
  }
];

const SAMPLE_CUSTOMERS = [
  { name: "Abebe Kebede", phone: "251911234567", totalOrders: 5, totalSpent: 1100 },
  { name: "Tigist Haile", phone: "251922334455", totalOrders: 3, totalSpent: 620 },
  { name: "Dawit Yohannes", phone: "251933445566", totalOrders: 2, totalSpent: 400 },
  { name: "Selamawit Bekele", phone: "251944556677", totalOrders: 1, totalSpent: 220 }
];

async function main() {
  console.log("Seeding menu items...");
  await prisma.orderItem.deleteMany({});
  await prisma.smsLog.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.menuItem.deleteMany({});

  for (const item of MENU_ITEMS) {
    await prisma.menuItem.create({ data: item });
  }

  console.log("Seeding sample customers...");
  for (const c of SAMPLE_CUSTOMERS) {
    await prisma.customer.create({ data: c });
  }

  // Create one sample active order
  const specialBorito = await prisma.menuItem.findFirst({ where: { name: "Special Borito" } });
  const tea = await prisma.menuItem.findFirst({ where: { name: "Traditional Spiced Tea" } });
  const customer = await prisma.customer.findFirst({ where: { phone: "251911234567" } });

  if (specialBorito && customer) {
    const order = await prisma.order.create({
      data: {
        orderNumber: "HBE-1001",
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        orderType: "PICKUP",
        notes: "Please add extra awaze sauce on the side.",
        totalAmount: 250,
        status: "PENDING",
        items: {
          create: [
            {
              menuItemId: specialBorito.id,
              itemName: specialBorito.name,
              quantity: 1,
              unitPrice: 220,
              totalPrice: 220
            },
            ...(tea ? [{
              menuItemId: tea.id,
              itemName: tea.name,
              quantity: 1,
              unitPrice: 30,
              totalPrice: 30
            }] : [])
          ]
        }
      }
    });

    await prisma.smsLog.create({
      data: {
        recipient: customer.phone,
        message: "Thank you Abebe! Your order #HBE-1001 at Haile Borito & Ertib has been received and is being prepared.",
        status: "SENT_SIMULATED",
        triggerType: "ORDER_CONFIRMATION",
        orderId: order.id,
        responseData: JSON.stringify({ status: "success", simulated: true })
      }
    });
  }

  console.log("Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
